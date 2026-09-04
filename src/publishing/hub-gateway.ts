import type { MetaPublishReceipt } from "./meta.js";

export type HubMetaProvider = "instagram" | "facebook";
export type HubMetaPlacement =
  | "instagram_feed"
  | "instagram_square"
  | "instagram_reel"
  | "facebook_feed"
  | "facebook_landscape";

export interface HubMetaPublishJob {
  job_id: string;
  planned_post_id: string;
  workspace_id: string;
  campaign_id: string;
  revision_id: string;
  provider: HubMetaProvider;
  placement_key: HubMetaPlacement;
  publish_at: string;
  timezone: string;
  copy_text: string;
  hashtags: string[];
  alt_text: string | null;
  destination_url: string | null;
  tracking_code: string | null;
  attempt_count: number;
  contract_version: 1;
  asset: {
    asset_file_id: string;
    asset_id: string;
    file_name: string;
    format_key: string;
    mime_type: "image/png" | "image/jpeg" | "video/mp4";
    width: number;
    height: number;
    qa_status: "passed";
    download_url: string;
    download_expires_in: number;
  };
}

type FetchLike = typeof fetch;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_ERROR_TEXT = 500;

export class PublishGatewayStore {
  private readonly endpoint: URL;

  constructor(
    endpoint: string,
    private readonly workerToken: string,
    private readonly fetcher: FetchLike = fetch
  ) {
    this.endpoint = checkedUrl(endpoint, "publish gateway");
    if (workerToken.length < 32) throw new Error("DOPA_PUBLISH_WORKER_TOKEN must be at least 32 characters");
  }

  async health(): Promise<void> {
    const response = await this.action<{ ok: boolean; version: number }>({ action: "health" });
    if (!response.ok || response.version !== 1) throw new Error("Publish gateway health check returned an unsupported version");
  }

  async claimMeta(): Promise<HubMetaPublishJob | null> {
    const response = await this.action<{ job: HubMetaPublishJob | null }>({ action: "claim_meta" });
    if (!response.job) return null;
    validateClaim(response.job);
    return response.job;
  }

  async complete(jobId: string, receipt: MetaPublishReceipt): Promise<void> {
    await this.action({
      action: "complete",
      job_id: jobId,
      external_post_id: receipt.platform_id,
      receipt: {
        platform_id: receipt.platform_id,
        ...(receipt.container_ids ? { container_ids: receipt.container_ids } : {})
      }
    });
  }

  async fail(jobId: string, errorText: string): Promise<void> {
    await this.action({ action: "fail", job_id: jobId, error_text: safeErrorText(errorText) });
  }

  private async action<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T> {
    const response = await this.fetcher(this.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-dopa-publish-worker-token": this.workerToken
      },
      body: JSON.stringify(body),
      redirect: "error"
    });
    const text = await readBoundedText(response, MAX_RESPONSE_BYTES);
    if (!response.ok) {
      const detail = text.trim().replace(/\s+/g, " ").slice(0, 300);
      throw new Error(`Publish gateway request failed (${response.status})${detail ? `: ${detail}` : ""}`);
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error("Publish gateway returned invalid JSON");
    }
  }
}

function validateClaim(job: HubMetaPublishJob): void {
  if (job.contract_version !== 1) throw new Error("Publish gateway returned an unsupported contract version");
  if (job.provider !== "instagram" && job.provider !== "facebook") throw new Error("Publish gateway returned a non-Meta provider");
  if (!job.job_id || !job.planned_post_id || !job.copy_text.trim()) throw new Error("Publish gateway returned an incomplete job");
  if (job.asset.qa_status !== "passed") throw new Error("Publish gateway returned an asset without passing QA");
  checkedUrl(job.asset.download_url, "asset download");
}

async function readBoundedText(response: Response, limit: number): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > limit) throw new Error("Publish gateway response exceeds the size limit");
  const text = await response.text();
  if (Buffer.byteLength(text) > limit) throw new Error("Publish gateway response exceeds the size limit");
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
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) throw new Error(`${label} URL must use HTTPS`);
  if (url.username || url.password) throw new Error(`${label} URL must not contain credentials`);
  return url;
}

function safeErrorText(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, MAX_ERROR_TEXT) || "Unknown publisher error";
}
