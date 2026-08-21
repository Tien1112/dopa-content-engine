import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const MAX_ARCHIVE_ENTRIES = 500;
const MAX_ENTRY_BYTES = 32 * 1024 * 1024;

export interface PreparedClaudeJobs {
  archive: string;
  square: { manifest: string; pages: number; canvas: { width: number; height: number } };
  pinterest?: { manifest: string; pages: number; source_dimensions: { width: number; height: number } };
  missing_approved_compositions: string[];
}

export interface PreparedHtmlJob {
  manifest: string;
  pages: number;
  canvas: { width: number; height: number };
  preset: string;
}

function unzip(args: string[], binary = false): Promise<string | Buffer> {
  return new Promise((resolve, reject) => {
    execFile("unzip", args, { encoding: binary ? "buffer" : "utf8", maxBuffer: MAX_ENTRY_BYTES }, (error, stdout, stderr) => {
      if (error) reject(new Error(`unzip failed: ${String(stderr || error.message).trim()}`));
      else resolve(stdout);
    });
  });
}

export function validateZipEntries(entries: string[]): void {
  if (entries.length === 0) throw new Error("Claude Design ZIP is empty");
  if (entries.length > MAX_ARCHIVE_ENTRIES) throw new Error(`Claude Design ZIP contains ${entries.length} entries; maximum is ${MAX_ARCHIVE_ENTRIES}`);
  for (const entry of entries) {
    if (!entry || entry.includes("\0") || entry.includes("\\") || path.posix.isAbsolute(entry) || entry.split("/").includes("..")) throw new Error(`Unsafe ZIP entry: ${entry}`);
  }
}

export function detectHtmlPages(html: string): { count: number; width: number; height: number } {
  const marker = /data-document-role=\\?"page\\?"/g;
  const count = [...html.matchAll(marker)].length;
  if (count === 0) throw new Error("Claude export contains no data-document-role=page canvases");
  const dimensions = [...html.matchAll(/data-document-role=\\?"page\\?"[^>]*?width:\s*(\d+)px;\s*height:\s*(\d+)px/gs)].map((match) => ({ width: Number(match[1]), height: Number(match[2]) }));
  if (dimensions.length !== count) throw new Error(`Could not determine dimensions for all ${count} Claude canvases`);
  const first = dimensions[0]!;
  if (dimensions.some((item) => item.width !== first.width || item.height !== first.height)) throw new Error("Claude export mixes canvas dimensions in one document");
  return { count, ...first };
}

export function readPngDimensions(buffer: Buffer): { width: number; height: number; alpha: boolean } {
  if (buffer.length < 26 || !buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error("Entry is not a valid PNG");
  const colorType = buffer[25]!;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), alpha: colorType === 4 || colorType === 6 };
}

export function detectFontFamilies(html: string): string[] {
  return [...new Set([...html.matchAll(/@font-face\s*\{[^}]*?font-family\s*:\s*\\?["']([^"';\\]+)/gs)].map((match) => match[1]!.trim()).filter(Boolean))].sort();
}

export function isTwoByThree(width: number, height: number): boolean {
  return width > 0 && height > 0 && width * 3 === height * 2;
}

export function exactPresetForCanvas(width: number, height: number): string {
  const key = `${width}x${height}`;
  const presets: Record<string, string> = {
    "1080x1080": "instagram_square",
    "1080x1350": "instagram_feed",
    "1080x1920": "instagram_story",
    "1000x1500": "pinterest_standard"
  };
  const preset = presets[key];
  if (!preset) throw new Error(`No approved exact output preset exists for canvas ${key}`);
  return preset;
}

export async function prepareClaudeDesignHtml(html: string, outputInput: string, brand = "imported-design"): Promise<PreparedHtmlJob> {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(brand)) throw new Error("brand must be a lowercase slug");
  const outputRoot = path.resolve(outputInput);
  const canvas = detectHtmlPages(html);
  const preset = exactPresetForCanvas(canvas.width, canvas.height);
  const requiredFonts = detectFontFamilies(html);
  await mkdir(path.join(outputRoot, "source"), { recursive: true });
  await writeFile(path.join(outputRoot, "source", "index.html"), html);
  const manifest = {
    schema_version: 1,
    content_id: `${brand}-claude-${preset}-approved`,
    brand,
    version: 1,
    source: "source/index.html",
    canvas: { width: canvas.width, height: canvas.height },
    pages: { selector: "[data-document-role=page]", label_attribute: "data-label", maximum: canvas.count },
    animation: false,
    transparent_background: false,
    ...(requiredFonts.length ? { required_fonts: requiredFonts } : {}),
    outputs: [{ preset, mode: "exact" }]
  };
  const manifestPath = path.join(outputRoot, "manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifest: manifestPath, pages: canvas.count, canvas: { width: canvas.width, height: canvas.height }, preset };
}

export async function prepareClaudeDesignZip(zipInput: string, outputInput: string, brand = "imported-design"): Promise<PreparedClaudeJobs> {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(brand)) throw new Error("brand must be a lowercase slug");
  const zipPath = path.resolve(zipInput);
  const outputRoot = path.resolve(outputInput);
  const listing = String(await unzip(["-Z1", zipPath]));
  const entries = listing.split(/\r?\n/).filter(Boolean);
  validateZipEntries(entries);

  const bundledCandidates = entries.filter((entry) => /(?:^|\/)[^/]+-export-bundled\.html$/i.test(entry));
  if (bundledCandidates.length !== 1) throw new Error(`Expected exactly one bundled Claude HTML export, found ${bundledCandidates.length}`);
  const html = String(await unzip(["-p", zipPath, bundledCandidates[0]!]));
  const canvas = detectHtmlPages(html);
  const requiredFonts = detectFontFamilies(html);

  const squareRoot = path.join(outputRoot, "square-source");
  await mkdir(path.join(squareRoot, "source"), { recursive: true });
  await writeFile(path.join(squareRoot, "source", "index.html"), html);
  const squareManifest = {
    schema_version: 1,
    content_id: `${brand}-claude-square-approved`,
    brand,
    version: 1,
    source: "source/index.html",
    canvas: { width: canvas.width, height: canvas.height },
    pages: { selector: "[data-document-role=page]", label_attribute: "data-label", maximum: canvas.count },
    animation: false,
    transparent_background: false,
    ...(requiredFonts.length ? { required_fonts: requiredFonts } : {}),
    outputs: [{ preset: "instagram_square", mode: "exact" }]
  };
  const squareManifestPath = path.join(squareRoot, "manifest.json");
  await writeFile(squareManifestPath, `${JSON.stringify(squareManifest, null, 2)}\n`);

  const rasterEntries: Array<{ entry: string; bytes: Buffer; width: number; height: number; alpha: boolean }> = [];
  for (const entry of entries.filter((item) => /^uploads\/[^/]+\.png$/i.test(item))) {
    const bytes = await unzip(["-p", zipPath, entry], true) as Buffer;
    const dimensions = readPngDimensions(bytes);
    if (isTwoByThree(dimensions.width, dimensions.height)) rasterEntries.push({ entry, bytes, ...dimensions });
  }

  let pinterest: PreparedClaudeJobs["pinterest"];
  if (rasterEntries.length) {
    const pinterestRoot = path.join(outputRoot, "pinterest-source");
    const assetsRoot = path.join(pinterestRoot, "source", "assets");
    await mkdir(assetsRoot, { recursive: true });
    const pages: string[] = [];
    const usedFilenames = new Set<string>();
    for (const raster of rasterEntries) {
      const base = path.posix.basename(raster.entry).replace(/[^A-Za-z0-9._-]+/g, "-").toLowerCase();
      if (usedFilenames.has(base)) throw new Error(`Duplicate Pinterest asset filename after normalization: ${base}`);
      usedFilenames.add(base);
      const filename = base;
      await writeFile(path.join(assetsRoot, filename), raster.bytes);
      pages.push(`<section data-document-role="page" data-label="${escapeHtml(path.parse(base).name)}"><img src="assets/${escapeHtml(filename)}" alt="" width="1000" height="1500"></section>`);
    }
    const wrapper = `<!doctype html>
<html><head><meta charset="utf-8"><style>*{box-sizing:border-box}html,body{margin:0;padding:0;background:transparent}body{display:flex;flex-direction:column;gap:32px}section{width:1000px;height:1500px;overflow:hidden}img{display:block;width:100%;height:100%;object-fit:contain}</style></head><body>${pages.join("")}</body></html>\n`;
    await writeFile(path.join(pinterestRoot, "source", "index.html"), wrapper);
    const pinterestManifest = {
      schema_version: 1,
      content_id: `${brand}-pinterest-approved`,
      brand,
      version: 1,
      source: "source/index.html",
      canvas: { width: 1000, height: 1500 },
      pages: { selector: "[data-document-role=page]", label_attribute: "data-label", maximum: rasterEntries.length },
      animation: false,
      transparent_background: rasterEntries.every((entry) => entry.alpha),
      outputs: [{ preset: "pinterest_standard", mode: "exact" }]
    };
    const pinterestManifestPath = path.join(pinterestRoot, "manifest.json");
    await writeFile(pinterestManifestPath, `${JSON.stringify(pinterestManifest, null, 2)}\n`);
    pinterest = { manifest: pinterestManifestPath, pages: rasterEntries.length, source_dimensions: { width: rasterEntries[0]!.width, height: rasterEntries[0]!.height } };
  }

  return {
    archive: zipPath,
    square: { manifest: squareManifestPath, pages: canvas.count, canvas: { width: canvas.width, height: canvas.height } },
    ...(pinterest ? { pinterest } : {}),
    missing_approved_compositions: ["instagram_feed_1080x1350", "instagram_story_1080x1920"]
  };
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
