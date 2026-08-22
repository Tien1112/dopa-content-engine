export interface RenderJobRow {
  id: string;
  workspace_id: string;
  campaign_id: string;
  revision_id: string;
  source_file_name: string;
  instruction: string | null;
  status: string;
  source_download_url: string;
}

export interface PublishedOutput {
  asset_id: string;
  design_code: string;
  format_key: string;
  file_name: string;
  mime_type: "image/png";
  byte_size: number;
  width: number;
  height: number;
  checksum_sha256: string;
  qa_report: unknown;
}

export interface RenderWorkerStore {
  claimNext(): Promise<RenderJobRow | null>;
  downloadSource(job: RenderJobRow): Promise<Buffer>;
  setQa(jobId: string): Promise<void>;
  publishOutput(jobId: string, output: PublishedOutput, bytes: Buffer): Promise<void>;
  complete(jobId: string): Promise<void>;
  fail(jobId: string, errorText: string): Promise<void>;
}

type FetchLike = typeof fetch;
const MAX_SOURCE_BYTES = 50 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;

export class RenderGatewayStore implements RenderWorkerStore {
  private readonly endpoint: URL;

  constructor(
    endpoint: string,
    private readonly workerToken: string,
    private readonly fetcher: FetchLike = fetch
  ) {
    this.endpoint = checkedUrl(endpoint, "gateway");
    if (workerToken.length < 32) throw new Error("DOPA_RENDER_WORKER_TOKEN must be at least 32 characters");
  }

  async health(): Promise<void> {
    const response = await this.action<{ ok: boolean; version: number }>({ action: "health" });
    if (!response.ok || response.version !== 1) throw new Error("Render gateway health check returned an unsupported version");
  }

  async claimNext(): Promise<RenderJobRow | null> {
    const response = await this.action<{ job: RenderJobRow | null }>({ action: "claim" });
    return response.job;
  }

  async downloadSource(job: RenderJobRow): Promise<Buffer> {
    const url = checkedUrl(job.source_download_url, "source download");
    const response = await this.fetcher(url, { method: "GET", redirect: "error" });
    if (!response.ok) throw new Error(`Source download failed (${response.status})`);
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_SOURCE_BYTES) throw new Error("Source package exceeds the 50 MB limit");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length) throw new Error("Source package is empty");
    if (bytes.length > MAX_SOURCE_BYTES) throw new Error("Source package exceeds the 50 MB limit");
    return bytes;
  }

  async setQa(jobId: string): Promise<void> {
    await this.action({ action: "set_qa", job_id: jobId });
  }

  async publishOutput(jobId: string, output: PublishedOutput, bytes: Buffer): Promise<void> {
    const reservation = await this.action<{ upload_url: string; storage_bucket: string; storage_path: string }>({
      action: "reserve_output",
      job_id: jobId,
      file_name: output.file_name,
      mime_type: output.mime_type
    });
    const uploadUrl = checkedUrl(reservation.upload_url, "output upload");
    const upload = await this.fetcher(uploadUrl, {
      method: "PUT",
      headers: { "content-type": output.mime_type },
      body: new Uint8Array(bytes),
      redirect: "error"
    });
    if (!upload.ok) throw new Error(`Output upload failed (${upload.status})`);
    await this.action({
      action: "record_output",
      job_id: jobId,
      storage_bucket: reservation.storage_bucket,
      storage_path: reservation.storage_path,
      output
    });
  }

  async complete(jobId: string): Promise<void> {
    await this.action({ action: "complete", job_id: jobId });
  }

  async fail(jobId: string, errorText: string): Promise<void> {
    await this.action({ action: "fail", job_id: jobId, error_text: errorText.slice(0, 4000) });
  }

  private async action<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T> {
    const response = await this.fetcher(this.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-dopa-worker-token": this.workerToken
      },
      body: JSON.stringify(body),
      redirect: "error"
    });
    const text = await readBoundedText(response, MAX_RESPONSE_BYTES);
    if (!response.ok) throw new Error(`Render gateway request failed (${response.status})`);
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error("Render gateway returned invalid JSON");
    }
  }
}

async function readBoundedText(response: Response, limit: number): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > limit) throw new Error("Render gateway response exceeds the size limit");
  const text = await response.text();
  if (Buffer.byteLength(text) > limit) throw new Error("Render gateway response exceeds the size limit");
  return text;
}

function checkedUrl(value: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid ${label} URL`);
  }
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error(`${label} URL must use HTTPS`);
  }
  if (url.username || url.password) throw new Error(`${label} URL must not contain credentials`);
  return url;
}
