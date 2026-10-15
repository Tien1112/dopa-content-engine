import { attributionRecords, attributionWindow, type AirbyteConnectionRoute, type AirbyteRouteProgress } from "./airbyte-worker.js";
import { HubDataGateway, type PerformanceRecord } from "./hub-data-gateway.js";
import { loadEtsyConfigFromEnvironment, type EtsyAccountDefinition, type EtsyConfig } from "../publishing/etsy.js";

type EtsyMoney = { amount?: unknown; divisor?: unknown };
type EtsyReceiptRow = {
  receipt_id?: unknown;
  status?: unknown;
  is_paid?: unknown;
  create_timestamp?: unknown;
  grandtotal?: EtsyMoney | null;
  transactions?: Array<{ listing_id?: unknown }>;
};
type EtsyListingRow = {
  listing_id?: unknown;
  state?: unknown;
  views?: unknown;
  num_favorers?: unknown;
  creation_timestamp?: unknown;
  updated_timestamp?: unknown;
};
type EtsyPage<T> = { count?: unknown; results?: T[] };

export type DirectEtsyDependencies = {
  fetchImpl?: typeof fetch;
  gateway?: HubDataGateway;
  config?: EtsyConfig;
  now?: Date;
};

export async function runDirectEtsySync(
  route: AirbyteConnectionRoute,
  onProgress?: (progress: AirbyteRouteProgress) => void,
  dependencies: DirectEtsyDependencies = {},
): Promise<void> {
  const gateway = dependencies.gateway ?? new HubDataGateway(required("DOPA_DATA_GATEWAY_URL"), required("DOPA_DATA_WORKER_TOKEN"));
  const config = dependencies.config ?? loadEtsyConfigFromEnvironment();
  const accountRef = process.env.DOPA_ETSY_ACCOUNT_REF ?? "dopa";
  const account = config.accounts[accountRef];
  if (!account) throw new Error(`No Etsy configuration for account_ref ${accountRef}`);
  let runId: string | undefined;
  onProgress?.({ name: route.name, status: "running" });
  try {
    await gateway.health();
    runId = await gateway.start("etsy", route.connectionId, 0);
    const records = await readEtsyPerformance({
      config,
      account,
      ...(dependencies.fetchImpl ? { fetchImpl: dependencies.fetchImpl } : {}),
      ...(dependencies.now ? { now: dependencies.now } : {}),
    });
    const rowsLoaded = await gateway.upsert("etsy", route.connectionId, runId, records);
    const orders = records.filter((record) => record.placement_key === "etsy_order");
    await gateway.replaceAttribution("etsy", route.connectionId, runId, attributionWindow(35, dependencies.now), attributionRecords("etsy", orders));
    await gateway.complete(runId, "succeeded", undefined, rowsLoaded);
    onProgress?.({ name: route.name, status: "succeeded", rowsLoaded });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (runId) await gateway.complete(runId, "failed", message).catch(() => undefined);
    onProgress?.({ name: route.name, status: "failed", error: message });
  }
}

export async function readEtsyPerformance(input: {
  config: EtsyConfig;
  account: EtsyAccountDefinition;
  fetchImpl?: typeof fetch;
  now?: Date;
}): Promise<PerformanceRecord[]> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const apiKey = process.env[input.account.api_key_env];
  const clientId = input.account.client_id_env ? process.env[input.account.client_id_env] : undefined;
  const refreshToken = input.account.refresh_token_env ? process.env[input.account.refresh_token_env] : undefined;
  if (!apiKey) throw new Error(`Missing Etsy API key environment variable ${input.account.api_key_env}`);
  if (!clientId || !refreshToken) throw new Error("Missing Etsy OAuth refresh credentials");
  const accessToken = await refreshAccessToken(clientId, refreshToken, fetchImpl);
  const base = new URL(`${(input.config.api_base_url ?? "https://openapi.etsy.com/v3/application").replace(/\/$/, "")}/`);
  const now = input.now ?? new Date();
  const minCreated = Math.floor((now.getTime() - 35 * 86_400_000) / 1000);
  const headers = { authorization: `Bearer ${accessToken}`, "x-api-key": apiKey };
  const receipts = await readAllPages<EtsyReceiptRow>(base, `shops/${input.account.shop_id}/receipts`, {
    min_created: String(minCreated), sort_on: "created", sort_order: "asc",
  }, headers, fetchImpl);
  const listings = await readAllPages<EtsyListingRow>(base, `shops/${input.account.shop_id}/listings`, {
    state: "active", sort_on: "updated", sort_order: "desc",
  }, headers, fetchImpl);
  return [...receipts.flatMap(receiptRecord), ...listings.flatMap(listingRecord)];
}

async function refreshAccessToken(clientId: string, refreshToken: string, fetchImpl: typeof fetch): Promise<string> {
  const response = await fetchImpl("https://api.etsy.com/v3/public/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", client_id: clientId, refresh_token: refreshToken }),
  });
  const body = await response.json().catch(() => undefined) as { access_token?: unknown; error?: unknown } | undefined;
  if (!response.ok || typeof body?.access_token !== "string" || !body.access_token) {
    const detail = typeof body?.error === "string" ? `: ${safe(body.error)}` : "";
    throw new Error(`Etsy OAuth refresh failed (${response.status})${detail}`);
  }
  return body.access_token;
}

async function readAllPages<T>(base: URL, endpoint: string, parameters: Record<string, string>, headers: Record<string, string>, fetchImpl: typeof fetch): Promise<T[]> {
  const records: T[] = [];
  for (let offset = 0, page = 0; page < 100; page += 1, offset += 100) {
    const url = new URL(endpoint, base);
    for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
    url.searchParams.set("limit", "100");
    url.searchParams.set("offset", String(offset));
    const response = await fetchImpl(url, { method: "GET", headers, redirect: "error" });
    const body = await response.json().catch(() => undefined) as EtsyPage<T> & { error?: unknown } | undefined;
    if (!response.ok || !body || !Array.isArray(body.results)) {
      const detail = typeof body?.error === "string" ? `: ${safe(body.error)}` : "";
      throw new Error(`Etsy API ${response.status}: request failed${detail}`);
    }
    records.push(...body.results);
    const count = numberValue(body.count);
    if (body.results.length < 100 || (count > 0 && records.length >= count)) return records;
  }
  throw new Error("Etsy API pagination exceeded 100 pages");
}

function receiptRecord(receipt: EtsyReceiptRow): PerformanceRecord[] {
  if (receipt.is_paid !== true) return [];
  const status = typeof receipt.status === "string" ? receipt.status.toLowerCase() : "";
  if (["canceled", "cancelled", "fully refunded"].includes(status)) return [];
  const receiptId = numericString(receipt.receipt_id);
  const created = timestamp(receipt.create_timestamp);
  if (!receiptId || !created) return [];
  const amount = numberValue(receipt.grandtotal?.amount);
  const divisor = numberValue(receipt.grandtotal?.divisor) || 100;
  const productRef = numericString(receipt.transactions?.[0]?.listing_id);
  return [{
    metric_date: amsterdamDate(created),
    placement_key: "etsy_order",
    external_post_id: receiptId,
    ...(productRef ? { product_ref: productRef } : {}),
    impressions: 0, reach: 0, engagements: 0, saves: 0, clicks: 0, video_views: 0, ad_spend_cents: 0,
    orders: 1,
    revenue_cents: Math.round(amount / divisor * 100),
  }];
}

function listingRecord(listing: EtsyListingRow): PerformanceRecord[] {
  if (listing.state !== "active") return [];
  const listingId = numericString(listing.listing_id);
  const updated = timestamp(listing.updated_timestamp) ?? timestamp(listing.creation_timestamp);
  if (!listingId || !updated) return [];
  const favorites = numberValue(listing.num_favorers);
  return [{
    metric_date: amsterdamDate(updated),
    placement_key: "etsy_listing_organic",
    external_post_id: listingId,
    product_ref: listingId,
    impressions: numberValue(listing.views),
    reach: 0,
    engagements: favorites,
    saves: favorites,
    clicks: 0,
    video_views: 0,
    ad_spend_cents: 0,
    orders: 0,
    revenue_cents: 0,
  }];
}

function timestamp(value: unknown): Date | undefined {
  const seconds = numberValue(value);
  if (!seconds) return undefined;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
function numberValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, value);
  if (typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value)) return Number(value);
  return 0;
}
function numericString(value: unknown): string | undefined {
  const result = String(value ?? "");
  return /^\d+$/.test(result) ? result : undefined;
}
function amsterdamDate(value: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
}
function safe(value: string): string { return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 300); }
function required(name: string): string { const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value; }
