import type { ContentPlanItem } from "./types.js";

export type HubChannelProvider = "pinterest" | "etsy" | "google_business_profile";

export interface HubChannelPublishJob {
  job_id: string;
  planned_post_id: string;
  provider: HubChannelProvider;
  placement_key: string;
  publish_at: string;
  copy_text: string;
  title: string | null;
  hashtags: string[];
  alt_text: string | null;
  destination_url: string | null;
  account_ref: string;
  provider_payload: Record<string, unknown>;
  contract_version: 1;
  asset: { asset_id: string; file_name: string; mime_type: "image/png" | "image/jpeg" | "video/mp4"; width: number; height: number; qa_status: "passed"; download_url: string };
}

export interface ChannelReceipt { platform_id: string; platform_url?: string }

export class ChannelGatewayStore {
  constructor(private readonly endpoint: string, private readonly token: string, private readonly fetchImpl: typeof fetch = fetch) {
    checkedHttps(endpoint, "channel gateway");
    if (token.length < 32) throw new Error("DOPA_PUBLISH_WORKER_TOKEN must be at least 32 characters");
  }
  async health(): Promise<void> { const result = await this.action<{ ok: boolean; version: number }>({ action: "health" }); if (!result.ok || result.version !== 1) throw new Error("Channel gateway health check failed"); }
  async claim(providers: HubChannelProvider[]): Promise<HubChannelPublishJob | null> { const result = await this.action<{ job: HubChannelPublishJob | null }>({ action: "claim_channel", providers }); if (!result.job) return null; validateJob(result.job, providers); return result.job; }
  async complete(jobId: string, receipt: ChannelReceipt): Promise<void> { await this.action({ action: "complete", job_id: jobId, external_post_id: receipt.platform_id, external_post_url: receipt.platform_url ?? null, receipt }); }
  async fail(jobId: string, error: string): Promise<void> { await this.action({ action: "fail", job_id: jobId, error_text: safeError(error) }); }
  private async action<T>(body: Record<string, unknown>): Promise<T> {
    const response = await this.fetchImpl(this.endpoint, { method: "POST", headers: { "content-type": "application/json", "x-dopa-publish-worker-token": this.token }, body: JSON.stringify(body), redirect: "error" });
    const raw = await response.text();
    if (Buffer.byteLength(raw) > 1024 * 1024) throw new Error("Channel gateway response exceeds 1 MB");
    if (!response.ok) throw new Error(`Channel gateway request failed (${response.status})`);
    try { return JSON.parse(raw) as T; } catch { throw new Error("Channel gateway returned invalid JSON"); }
  }
}

export function channelJobToPlanItem(job: HubChannelPublishJob): ContentPlanItem {
  return {
    item_id: job.planned_post_id,
    channel: job.provider,
    content_type: job.provider === "pinterest" ? "pin" : job.provider === "etsy" ? "listing" : "update",
    account_ref: job.account_ref,
    publish_at: job.publish_at,
    media: [{ asset_id: job.asset.asset_id, file: job.asset.file_name, public_url: checkedHttps(job.asset.download_url, "asset"), mime_type: job.asset.mime_type, width: job.asset.width, height: job.asset.height, qa: job.asset.qa_status }],
    copy: { message: job.copy_text, ...(job.title ? { title: job.title } : {}), hashtags: job.hashtags, ...(job.alt_text ? { alt_text: job.alt_text } : {}), ...(job.destination_url ? { destination_url: job.destination_url } : {}) },
    provider_payload: job.provider_payload
  };
}

function validateJob(job: HubChannelPublishJob, requested: HubChannelProvider[]): void {
  if (job.contract_version !== 1 || !requested.includes(job.provider)) throw new Error("Gateway returned an unsupported provider contract");
  if (!job.job_id || !job.planned_post_id || !job.account_ref || !job.copy_text.trim()) throw new Error("Gateway returned an incomplete channel job");
  if (job.asset.qa_status !== "passed") throw new Error("Gateway returned an asset without passing QA");
  checkedHttps(job.asset.download_url, "asset");
}

function checkedHttps(value: string, label: string): string { const url = new URL(value); if (url.protocol !== "https:" || url.username || url.password) throw new Error(`${label} URL must be credential-free HTTPS`); return url.toString(); }
function safeError(value: string): string { return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 500) || "Unknown publisher error"; }
