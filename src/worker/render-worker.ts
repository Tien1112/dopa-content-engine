import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prepareClaudeDesignHtmlVariants, prepareClaudeDesignZip } from "../adapters/claude-design-zip.js";
import { renderJob } from "../core/render.js";
import type { OutputQa, QaReport } from "../core/types.js";
import { RenderGatewayStore, type RenderJobRow, type RenderWorkerStore } from "./gateway.js";

export async function processRenderJob(store: RenderWorkerStore, job: RenderJobRow): Promise<void> {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), `dopa-render-${job.id}-`));
  console.log(`[render:${job.id}] picked up ${safeFileName(job.source_file_name)}`);
  try {
    const sourceBytes = await store.downloadSource(job);
    const sourceName = safeFileName(job.source_file_name);
    const sourceFile = path.join(temporaryRoot, sourceName);
    await writeFile(sourceFile, sourceBytes);
    const preparedRoot = path.join(temporaryRoot, "prepared");
    const manifests: string[] = [];
    if (!job.requested_formats.length) throw new Error("Render job has no requested format contract");
    if (sourceName.toLowerCase().endsWith(".zip")) {
      const prepared = await prepareClaudeDesignZip(sourceFile, preparedRoot, "dopa", job.requested_formats);
      manifests.push(...prepared.variants.map((variant) => variant.manifest));
    } else if (sourceName.toLowerCase().endsWith(".html")) {
      const prepared = await prepareClaudeDesignHtmlVariants(sourceBytes.toString("utf8"), path.join(preparedRoot, "html"), "dopa", job.requested_formats);
      manifests.push(...prepared.variants.map((variant) => variant.manifest));
    } else {
      throw new Error("Only .zip and .html source packages are supported");
    }

    console.log(`[render:${job.id}] package prepared; ${manifests.length} approved composition(s) queued`);
    await store.setQa(job.id);
    const reports: Array<{ report: QaReport; root: string }> = [];
    for (const [index, manifest] of manifests.entries()) {
      console.log(`[render:${job.id}] rendering composition ${index + 1}/${manifests.length}`);
      reports.push({ report: await renderJob(manifest), root: path.dirname(manifest) });
    }
    const failedReports = reports.filter(({ report }) => report.status !== "passed");
    if (failedReports.length) {
      const errors = [...new Set(failedReports.flatMap(({ report }) => report.outputs.flatMap((output) => output.errors)))];
      throw new Error(`Machine-readable QA failed: ${errors.join("; ") || "unknown QA error"}`);
    }

    for (const { report, root } of reports) {
      for (const output of report.outputs) await storePassedOutput(store, job, root, output, report);
    }
    await store.complete(job.id);
    console.log(`[render:${job.id}] completed; all outputs passed QA`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[render:${job.id}] failed: ${message}`);
    try {
      await store.fail(job.id, message);
    } catch (failError) {
      console.error(`Render job ${job.id} failed and failure reporting also failed: ${safeError(failError)}`);
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function storePassedOutput(store: RenderWorkerStore, job: RenderJobRow, packageRoot: string, output: OutputQa, report: QaReport): Promise<void> {
  if (output.qa !== "passed" || !output.file) throw new Error("Refusing to store output without passing QA");
  const width = output.width;
  const height = output.height;
  if (!width || !height || !Number.isInteger(width) || !Number.isInteger(height)) {
    throw new Error("Refusing to store output without exact positive dimensions");
  }
  const localFile = path.resolve(packageRoot, output.file);
  if (!localFile.startsWith(`${path.resolve(packageRoot)}${path.sep}`)) throw new Error("QA output path escaped its package");
  const bytes = await readFile(localFile);
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const fileName = safeFileName(path.basename(localFile));
  const designCode = output.page_label ?? path.parse(fileName).name;
  await store.publishOutput(job.id, {
    asset_id: `${job.id}-${designCode}-${output.preset}`,
    design_code: designCode,
    format_key: output.preset,
    file_name: fileName,
    mime_type: output.format === "mp4" ? "video/mp4" : "image/png",
    byte_size: bytes.length,
    width,
    height,
    checksum_sha256: checksum,
    qa_report: { qa: "passed", content_id: report.content_id, output }
  }, bytes);
}

function safeFileName(value: string): string {
  const base = path.basename(value).replace(/[^A-Za-z0-9._-]+/g, "-");
  if (!base || base === "." || base === "..") throw new Error("Unsafe source filename");
  return base;
}

export async function runWorker(): Promise<void> {
  const gatewayUrl = requiredEnv("DOPA_RENDER_GATEWAY_URL");
  const workerToken = requiredEnv("DOPA_RENDER_WORKER_TOKEN");
  const store = new RenderGatewayStore(gatewayUrl, workerToken);
  await store.health();
  const once = process.env.RENDER_ONCE === "1";
  const interval = Math.max(1000, Number(process.env.RENDER_POLL_INTERVAL_MS ?? 5000));
  do {
    const job = await store.claimNext();
    if (job) await processRenderJob(store, job);
    if (once) return;
    await new Promise((resolve) => setTimeout(resolve, job ? 100 : interval));
  } while (true);
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
