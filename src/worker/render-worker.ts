import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prepareClaudeDesignHtml, prepareClaudeDesignZip } from "../adapters/claude-design-zip.js";
import { renderJob } from "../core/render.js";
import type { OutputQa, QaReport } from "../core/types.js";
import { SupabaseRenderStore, type RenderJobRow } from "./supabase.js";

interface StoredId { id: string }

export async function processRenderJob(store: SupabaseRenderStore, job: RenderJobRow): Promise<void> {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), `dopa-render-${job.id}-`));
  try {
    const sourceBytes = await store.download(job.source_bucket, job.source_path);
    const sourceName = safeFileName(job.source_file_name);
    const sourceFile = path.join(temporaryRoot, sourceName);
    await writeFile(sourceFile, sourceBytes);
    const preparedRoot = path.join(temporaryRoot, "prepared");
    const manifests: string[] = [];
    if (sourceName.toLowerCase().endsWith(".zip")) {
      const prepared = await prepareClaudeDesignZip(sourceFile, preparedRoot, "dopa");
      manifests.push(prepared.square.manifest);
      if (prepared.pinterest) manifests.push(prepared.pinterest.manifest);
    } else if (sourceName.toLowerCase().endsWith(".html")) {
      const prepared = await prepareClaudeDesignHtml(sourceBytes.toString("utf8"), path.join(preparedRoot, "html"), "dopa");
      manifests.push(prepared.manifest);
    } else {
      throw new Error("Only .zip and .html source packages are supported");
    }

    await store.updateJob(job.id, { status: "qa_controle" });
    const reports: Array<{ report: QaReport; root: string }> = [];
    for (const manifest of manifests) reports.push({ report: await renderJob(manifest), root: path.dirname(manifest) });
    const failedReports = reports.filter(({ report }) => report.status !== "passed");
    if (failedReports.length) {
      const errors = failedReports.flatMap(({ report }) => report.outputs.flatMap((output) => output.errors));
      throw new Error(`Machine-readable QA failed: ${errors.join("; ") || "unknown QA error"}`);
    }

    for (const { report, root } of reports) {
      for (const output of report.outputs) await storePassedOutput(store, job, root, output, report);
    }
    await store.updateRevision(job.revision_id, { status: "in_review", label: "Render gereed voor review" });
    await store.updateCampaign(job.campaign_id, { status: "in_review" });
    await store.updateJob(job.id, { status: "klaar_voor_review", error_text: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await store.updateJob(job.id, { status: "mislukt", error_text: message.slice(0, 4000) });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function storePassedOutput(store: SupabaseRenderStore, job: RenderJobRow, packageRoot: string, output: OutputQa, report: QaReport): Promise<void> {
  if (output.qa !== "passed" || !output.file) throw new Error("Refusing to store output without passing QA");
  const localFile = path.resolve(packageRoot, output.file);
  if (!localFile.startsWith(`${path.resolve(packageRoot)}${path.sep}`)) throw new Error("QA output path escaped its package");
  const bytes = await readFile(localFile);
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const fileName = safeFileName(path.basename(localFile));
  const storagePath = `${job.workspace_id}/${job.campaign_id}/${job.revision_id}/${fileName}`;
  await store.upload("canonical-assets", storagePath, bytes, "image/png");
  const designCode = output.page_label ?? path.parse(fileName).name;
  const content = await store.insert<StoredId>("content_items", {
    workspace_id: job.workspace_id,
    campaign_id: job.campaign_id,
    revision_id: job.revision_id,
    design_code: designCode,
    title: designCode
  });
  const asset = await store.insert<StoredId>("asset_files", {
    workspace_id: job.workspace_id,
    campaign_id: job.campaign_id,
    content_item_id: content.id,
    source_revision_id: job.revision_id,
    asset_id: `${job.id}-${designCode}-${output.preset}`,
    kind: "image",
    format_key: output.preset,
    file_name: fileName,
    storage_bucket: "canonical-assets",
    storage_path: storagePath,
    mime_type: "image/png",
    byte_size: bytes.length,
    width: output.width,
    height: output.height,
    checksum_sha256: checksum,
    qa_status: "passed",
    import_state: "canonical_storage"
  });
  await store.insert<StoredId>("qa_results", {
    workspace_id: job.workspace_id,
    asset_file_id: asset.id,
    status: "passed",
    checked_by: "dopa-render-engine",
    report: { content_id: report.content_id, output }
  });
}

function safeFileName(value: string): string {
  const base = path.basename(value).replace(/[^A-Za-z0-9._-]+/g, "-");
  if (!base || base === "." || base === "..") throw new Error("Unsafe source filename");
  return base;
}

export async function runWorker(): Promise<void> {
  const baseUrl = requiredEnv("SUPABASE_URL");
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const store = new SupabaseRenderStore(baseUrl, serviceRoleKey);
  const once = process.env.RENDER_ONCE === "1";
  const interval = Math.max(1000, Number(process.env.RENDER_POLL_INTERVAL_MS ?? 5000));
  do {
    const job = await store.claimNext();
    if (job) await processRenderJob(store, job);
    if (once) return;
    await new Promise((resolve) => setTimeout(resolve, job ? 100 : interval));
  } while (true);
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
