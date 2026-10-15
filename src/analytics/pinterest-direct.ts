import type { AirbyteConnectionRoute, AirbyteRouteProgress } from "./airbyte-worker.js";
import { HubDataGateway, type PerformanceRecord } from "./hub-data-gateway.js";
import type { PinterestAccountDefinition, PinterestConfig } from "../publishing/pinterest.js";

type PinterestPin = { id?: unknown };
type PinterestPinPage = { items?: PinterestPin[]; bookmark?: unknown; message?: unknown };
type PinterestDailyMetric = { date?: unknown; metrics?: Record<string, unknown> };
type PinterestMetricGroup = { daily_metrics?: PinterestDailyMetric[] };
type PinterestAnalyticsResponse = Record<string, PinterestMetricGroup> & { message?: unknown };

export type DirectPinterestDependencies = {
  fetchImpl?: typeof fetch;
  gateway?: HubDataGateway;
  config?: PinterestConfig;
  now?: Date;
};

/** Read daily organic Pin analytics directly from Pinterest, without Airbyte. */
export async function runDirectPinterestSync(
  route: AirbyteConnectionRoute,
  onProgress?: (progress: AirbyteRouteProgress) => void,
  dependencies: DirectPinterestDependencies = {},
): Promise<void> {
  const gateway = dependencies.gateway ?? new HubDataGateway(required("DOPA_DATA_GATEWAY_URL"), required("DOPA_DATA_WORKER_TOKEN"));
  const config = dependencies.config ?? pinterestConfigFromEnvironment();
  const accountRef = process.env.DOPA_PINTEREST_ACCOUNT_REF ?? "dopa";
  const account = config.accounts[accountRef];
  if (!account) throw new Error(`No Pinterest configuration for account_ref ${accountRef}`);
  let runId: string | undefined;
  onProgress?.({ name: route.name, status: "running" });
  try {
    await gateway.health();
    runId = await gateway.start("pinterest", route.connectionId, 0);
    const records = await readPinterestPerformance({
      config,
      account,
      ...(dependencies.fetchImpl ? { fetchImpl: dependencies.fetchImpl } : {}),
      ...(dependencies.now ? { now: dependencies.now } : {}),
    });
    const rowsLoaded = await gateway.upsert("pinterest", route.connectionId, runId, records);
    await gateway.complete(runId, "succeeded", undefined, rowsLoaded);
    onProgress?.({ name: route.name, status: "succeeded", rowsLoaded });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (runId) await gateway.complete(runId, "failed", message).catch(() => undefined);
    onProgress?.({ name: route.name, status: "failed", error: message });
  }
}

export async function readPinterestPerformance(input: {
  config: PinterestConfig;
  account: PinterestAccountDefinition;
  fetchImpl?: typeof fetch;
  now?: Date;
}): Promise<PerformanceRecord[]> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const token = await pinterestAccessToken(input.config, input.account, fetchImpl);
  const base = new URL(`${(input.config.api_base_url ?? "https://api.pinterest.com").replace(/\/$/, "")}/v5/`);
  const now = input.now ?? new Date();
  const startDate = utcDay(new Date(now.getTime() - 34 * 86_400_000));
  const endDate = utcDay(now);
  const pinIds = await listPinIds(base, token, fetchImpl);
  const records: PerformanceRecord[] = [];
  for (const pinId of pinIds) {
    const url = new URL(`pins/${encodeURIComponent(pinId)}/analytics`, base);
    url.searchParams.set("start_date", startDate);
    url.searchParams.set("end_date", endDate);
    url.searchParams.set("app_types", "ALL");
    url.searchParams.set("split_field", "NO_SPLIT");
    url.searchParams.set("metric_types", "IMPRESSION,SAVE,PIN_CLICK,OUTBOUND_CLICK,VIDEO_MRC_VIEW");
    const body = await pinterestJson<PinterestAnalyticsResponse>(url, token, fetchImpl);
    for (const group of Object.values(body)) {
      if (!group || typeof group !== "object") continue;
      const metricsGroup = group as PinterestMetricGroup;
      if (!Array.isArray(metricsGroup.daily_metrics)) continue;
      for (const day of metricsGroup.daily_metrics) {
        const metricDate = calendarDay(day.date);
        if (!metricDate) continue;
        const metrics = day.metrics ?? {};
        const saves = numberValue(metrics.SAVE);
        const pinClicks = numberValue(metrics.PIN_CLICK);
        const outboundClicks = numberValue(metrics.OUTBOUND_CLICK);
        records.push({
          metric_date: metricDate,
          placement_key: "pinterest_pin_organic",
          external_post_id: pinId,
          impressions: numberValue(metrics.IMPRESSION),
          reach: 0,
          engagements: saves + pinClicks + outboundClicks,
          saves,
          clicks: outboundClicks,
          video_views: numberValue(metrics.VIDEO_MRC_VIEW),
          ad_spend_cents: 0,
          orders: 0,
          revenue_cents: 0,
        });
      }
    }
  }
  return records;
}

async function listPinIds(base: URL, token: string, fetchImpl: typeof fetch): Promise<string[]> {
  const limit = positiveInteger(process.env.DOPA_PINTEREST_MAX_PINS, 500, 1000);
  const ids: string[] = [];
  let bookmark: string | undefined;
  for (let page = 0; page < 100 && ids.length < limit; page += 1) {
    const url = new URL("pins", base);
    url.searchParams.set("page_size", String(Math.min(250, limit - ids.length)));
    if (bookmark) url.searchParams.set("bookmark", bookmark);
    const body = await pinterestJson<PinterestPinPage>(url, token, fetchImpl);
    if (!Array.isArray(body.items)) throw new Error("Pinterest API returned an invalid Pin page");
    for (const pin of body.items) {
      const id = stringValue(pin.id);
      if (id) ids.push(id);
    }
    bookmark = stringValue(body.bookmark);
    if (!bookmark) return ids;
  }
  return ids;
}

async function pinterestAccessToken(config: PinterestConfig, account: PinterestAccountDefinition, fetchImpl: typeof fetch): Promise<string> {
  if (account.access_token_env) return required(account.access_token_env);
  if (!account.client_id_env || !account.client_secret_env) throw new Error("Pinterest account needs access_token_env or client credentials");
  const clientId = required(account.client_id_env);
  const clientSecret = required(account.client_secret_env);
  const scopes = new Set(account.scopes ?? ["boards:read", "pins:read"]);
  scopes.add("boards:read");
  scopes.add("pins:read");
  const response = await fetchImpl(`${(config.api_base_url ?? "https://api.pinterest.com").replace(/\/$/, "")}/v5/oauth/token`, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials", scope: [...scopes].join(",") }),
    redirect: "error",
  });
  const body = await response.json().catch(() => undefined) as { access_token?: unknown; message?: unknown } | undefined;
  if (!response.ok || typeof body?.access_token !== "string" || !body.access_token) {
    throw new Error(`Pinterest OAuth ${response.status}: ${safe(stringValue(body?.message) ?? "request failed")}`);
  }
  return body.access_token;
}

async function pinterestJson<T>(url: URL, token: string, fetchImpl: typeof fetch): Promise<T> {
  const response = await fetchImpl(url, { headers: { authorization: `Bearer ${token}`, accept: "application/json" }, redirect: "error" });
  const body = await response.json().catch(() => undefined) as (T & { message?: unknown }) | undefined;
  if (!response.ok || !body) throw new Error(`Pinterest API ${response.status}: ${safe(stringValue(body?.message) ?? "request failed")}`);
  return body;
}

function pinterestConfigFromEnvironment(): PinterestConfig {
  try { return JSON.parse(required("DOPA_PINTEREST_CONFIG_JSON")) as PinterestConfig; }
  catch (error) {
    if (error instanceof SyntaxError) throw new Error("DOPA_PINTEREST_CONFIG_JSON must contain valid JSON");
    throw error;
  }
}
function numberValue(value: unknown): number { return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0; }
function stringValue(value: unknown): string | undefined { return typeof value === "string" && value ? value : undefined; }
function calendarDay(value: unknown): string | undefined { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined; }
function utcDay(value: Date): string { return value.toISOString().slice(0, 10); }
function positiveInteger(value: string | undefined, fallback: number, maximum: number): number { const parsed = Number(value); return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback; }
function safe(value: string): string { return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 300); }
function required(name: string): string { const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value; }
