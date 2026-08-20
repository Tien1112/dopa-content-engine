import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { loadPresets } from "./config.js";
import { inspectPackage } from "./inspect.js";
import { loadManifest, resolveInsidePackage } from "./manifest.js";
import { verifyPng } from "./qa.js";
import type { OutputQa, QaReport } from "./types.js";

interface RenderTarget {
  label?: string;
  selector?: string;
  index?: number;
}

export async function renderJob(manifestPathInput: string): Promise<QaReport> {
  const manifestPath = path.resolve(manifestPathInput);
  const packageRoot = path.dirname(manifestPath);
  const outputDir = path.join(packageRoot, "renders");
  await mkdir(outputDir, { recursive: true });
  const manifest = await loadManifest(manifestPath);
  const sourcePath = resolveInsidePackage(manifestPath, manifest.source);
  const inspection = await inspectPackage(packageRoot, sourcePath);
  const report: QaReport = { content_id: manifest.content_id, status: "failed", inspection, outputs: [] };
  const reportPath = path.join(outputDir, "qa-report.json");
  const finish = async () => { report.status = report.outputs.length > 0 && report.outputs.every((o) => o.qa === "passed") ? "passed" : "failed"; await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`); return report; };
  if (inspection.issues.length) { report.outputs.push(failed("preflight", inspection.issues)); return finish(); }
  if (manifest.animation) { report.outputs.push(failed("animation", ["Animation rendering is not implemented in the static Phase 1 slice"])); return finish(); }
  const presets = await loadPresets();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    for (const request of manifest.outputs) {
      const errors: string[] = [];
      const preset = presets[request.preset];
      if (!preset) { report.outputs.push(failed(request.preset, [`Unknown preset: ${request.preset}`])); continue; }
      if (preset.format !== "png") { report.outputs.push(failed(request.preset, [`Static slice cannot render ${preset.format}`])); continue; }
      const mode = request.mode ?? "exact";
      if (mode !== "exact") { report.outputs.push(failed(request.preset, [`Render mode ${mode} is not implemented; refusing to distort the design`])); continue; }
      if (preset.width !== manifest.canvas.width || preset.height !== manifest.canvas.height) { report.outputs.push(failed(request.preset, [`exact mode requires source canvas ${manifest.canvas.width}x${manifest.canvas.height} to equal preset ${preset.width}x${preset.height}`])); continue; }
      const context = await browser.newContext({ viewport: { width: preset.width, height: preset.height }, deviceScaleFactor: 1, reducedMotion: "reduce" });
      const page = await context.newPage();
      const failedResources: string[] = [];
      page.on("requestfailed", (request) => failedResources.push(`${request.url()}: ${request.failure()?.errorText ?? "failed"}`));
      await page.route("**/*", async (route) => {
        const protocol = new URL(route.request().url()).protocol;
        if (["file:", "data:", "blob:"].includes(protocol)) await route.continue();
        else { failedResources.push(`Blocked external request: ${route.request().url()}`); await route.abort("blockedbyclient"); }
      });
      try {
        await page.goto(pathToFileURL(sourcePath).href, { waitUntil: "load", timeout: 15_000 });
        await page.evaluate(async () => {
          await document.fonts.ready;
          await Promise.all([...document.images].map((image) => image.complete ? Promise.resolve() : new Promise<void>((resolve, reject) => { image.addEventListener("load", () => resolve(), { once: true }); image.addEventListener("error", () => reject(new Error(image.currentSrc || image.src)), { once: true }); })));
        });
        const unavailableFonts = await page.evaluate((fonts) => fonts.filter((font) => !document.fonts.check(`16px "${font.replaceAll('"', '\\"')}"`)), manifest.required_fonts ?? []);
        if (failedResources.length) errors.push(...failedResources);
        if (unavailableFonts.length) errors.push(`Required fonts unavailable: ${unavailableFonts.join(", ")}`);
        const targets = await findRenderTargets(page, manifest.pages);
        if (targets.error) {
          report.outputs.push(failed(request.preset, [...errors, targets.error]));
          continue;
        }
        for (const target of targets.items) {
          const targetErrors = [...errors];
          let locator;
          if (target.selector !== undefined && target.index !== undefined) {
            locator = page.locator(target.selector).nth(target.index);
            const box = await locator.boundingBox();
            if (!box) targetErrors.push(`Page ${target.label} is not visible`);
            else if (Math.round(box.width) !== manifest.canvas.width || Math.round(box.height) !== manifest.canvas.height) targetErrors.push(`Page ${target.label} expected ${manifest.canvas.width}x${manifest.canvas.height}, got ${Math.round(box.width)}x${Math.round(box.height)}`);
          }
          const outputName = target.label ? `${target.label}-${request.preset}.png` : `${request.preset}.png`;
          const outputFile = path.join(outputDir, outputName);
          if (!targetErrors.length) {
            if (locator) await locator.screenshot({ path: outputFile, type: "png", omitBackground: manifest.transparent_background ?? false, animations: "disabled" });
            else await page.screenshot({ path: outputFile, type: "png", omitBackground: manifest.transparent_background ?? false, animations: "disabled" });
          }
          let qa: OutputQa = { preset: request.preset, ...(target.label ? { page_label: target.label } : {}), file: path.relative(packageRoot, outputFile), fonts_loaded: unavailableFonts.length === 0, assets_loaded: failedResources.length === 0, qa: "failed", errors: targetErrors };
          if (!targetErrors.length) {
            qa = await verifyPng({ preset: request.preset, ...(target.label ? { pageLabel: target.label } : {}), file: outputFile, reportFile: path.relative(packageRoot, outputFile), expectedWidth: preset.width, expectedHeight: preset.height, requireAlpha: manifest.transparent_background ?? false, fontsLoaded: true, assetsLoaded: true });
          }
          report.outputs.push(qa);
        }
      } catch (error) { report.outputs.push(failed(request.preset, [String(error)])); }
      finally { await context.close(); }
    }
  } catch (error) { report.outputs.push(failed("renderer", [`Unable to start Chromium: ${String(error)}`])); }
  finally { if (browser) await browser.close(); }
  return finish();
}

async function findRenderTargets(page: import("playwright").Page, selection: import("./types.js").PageSelection | undefined): Promise<{ items: RenderTarget[]; error?: string }> {
  if (!selection) return { items: [{}] };
  const locator = page.locator(selection.selector);
  const count = await locator.count();
  if (count === 0) return { items: [], error: `Page selector matched no elements: ${selection.selector}` };
  const maximum = selection.maximum ?? 100;
  if (count > maximum) return { items: [], error: `Page selector matched ${count} elements; maximum is ${maximum}` };
  const attribute = selection.label_attribute ?? "data-label";
  const seen = new Set<string>();
  const items: RenderTarget[] = [];
  for (let index = 0; index < count; index += 1) {
    const raw = (await locator.nth(index).getAttribute(attribute)) ?? String(index + 1).padStart(2, "0");
    const label = safeLabel(raw);
    if (seen.has(label)) return { items: [], error: `Duplicate page label after filename normalization: ${label}` };
    seen.add(label);
    items.push({ label, selector: selection.selector, index });
  }
  return { items };
}

export function safeLabel(value: string): string {
  const normalized = value.normalize("NFKD").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
  return normalized || "page";
}

function failed(preset: string, errors: string[]): OutputQa {
  return { preset, file: "", fonts_loaded: false, assets_loaded: false, qa: "failed", errors };
}
