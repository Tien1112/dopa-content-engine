import type { AirbyteJobStatus } from "./airbyte.js";

export type DataGatewayCompletionStatus = Extract<AirbyteJobStatus, "succeeded" | "failed" | "cancelled">;

export type DataProvider =
  | "facebook"
  | "instagram"
  | "pinterest"
  | "etsy"
  | "shopify"
  | "google_analytics"
  | "google_search_console"
  | "google_ads"
  | "google_business_profile"
  | "google_merchant_center";

export type PerformanceRecord = {
  metric_date: string;
  placement_key?: string;
  external_post_id?: string;
  tracking_code?: string;
  product_ref?: string;
  impressions?: number;
  reach?: number;
  engagements?: number;
  saves?: number;
  clicks?: number;
  video_views?: number;
  ad_spend_cents?: number;
  orders?: number;
  revenue_cents?: number;
};

export class HubDataGateway {
  constructor(private readonly endpoint: string, private readonly token: string, private readonly fetchImpl: typeof fetch = fetch) {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("Data gateway URL must be credential-free HTTPS");
    if (token.length < 32) throw new Error("DOPA_DATA_WORKER_TOKEN must be at least 32 characters");
  }
  async health(): Promise<void> { const value = await this.action<{ ok: boolean; version: number }>({ action: "health" }); if (!value.ok || value.version !== 1) throw new Error("Data gateway health check failed"); }
  async start(provider: DataProvider, connectionRef: string, airbyteJobId: number): Promise<string> { const value = await this.action<{ run_id: string }>({ action: "start_run", provider, connection_ref: connectionRef, airbyte_job_id: airbyteJobId }); if (!value.run_id) throw new Error("Data gateway returned no run_id"); return value.run_id; }
  async complete(runId: string, status: DataGatewayCompletionStatus, error?: string, rowsLoaded?: number): Promise<void> {
    await this.action({
      action: "complete_run",
      run_id: runId,
      status,
      ...(error ? { error_text: safe(error) } : {}),
      ...(rowsLoaded === undefined ? {} : { rows_loaded: rowsLoaded })
    });
  }
  async upsert(provider: DataProvider, connectionRef: string, runId: string, records: readonly PerformanceRecord[]): Promise<number> {
    const uniqueRecords = dedupePerformanceRecords(records);
    let loaded = 0;
    for (let offset = 0; offset < uniqueRecords.length; offset += 500) {
      const batch = uniqueRecords.slice(offset, offset + 500);
      const value = await this.action<{ received: number }>({ action: "upsert_performance", provider, connection_ref: connectionRef, run_id: runId, records: batch });
      loaded += value.received;
    }
    return loaded;
  }
  private async action<T>(body: Record<string, unknown>): Promise<T> {
    const response = await this.fetchImpl(this.endpoint, { method: "POST", headers: { "content-type": "application/json", "x-dopa-data-worker-token": this.token }, body: JSON.stringify(body), redirect: "error" });
    const raw = await response.text();
    if (Buffer.byteLength(raw) > 1024 * 1024) throw new Error("Data gateway response exceeds 1 MB");
    if (!response.ok) throw new Error(`Data gateway request failed (${response.status})`);
    try { return JSON.parse(raw) as T; } catch { throw new Error("Data gateway returned invalid JSON"); }
  }
}

/** Airbyte can expose repeated snapshots for the same normalized daily key. */
export function dedupePerformanceRecords(records: readonly PerformanceRecord[]): PerformanceRecord[] {
  const unique = new Map<string, PerformanceRecord>();
  for (const record of records) {
    const key = [
      record.metric_date,
      record.placement_key ?? "",
      record.external_post_id ?? record.tracking_code ?? record.product_ref ?? "aggregate"
    ].join("|");
    unique.set(key, record);
  }
  return [...unique.values()];
}

function safe(value: string): string { return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 500); }
