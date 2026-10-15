import { HubDataGateway, type PerformanceRecord } from "./hub-data-gateway.js";
import type { AirbyteConnectionRoute, AirbyteRouteProgress } from "./airbyte-worker.js";
import { loadMetaConfigFromEnvironment, type MetaConfigFile } from "../publishing/meta.js";

type FacebookPost = {
  id?: unknown;
  created_time?: unknown;
  message?: unknown;
  shares?: { count?: unknown } | null;
  comments?: { summary?: { total_count?: unknown } } | null;
  reactions?: { summary?: { total_count?: unknown } } | null;
};

type FacebookInsight = {
  name?: unknown;
  values?: Array<{ value?: unknown }>;
};

type GraphPage<T> = {
  data?: T[];
  paging?: { cursors?: { after?: unknown }; next?: unknown };
  error?: { message?: unknown; code?: unknown };
};

export type DirectFacebookDependencies = {
  fetchImpl?: typeof fetch;
  gateway?: HubDataGateway;
  config?: MetaConfigFile;
  now?: Date;
};

/** Run Facebook organic ingestion directly against Meta, without an Airbyte job. */
export async function runDirectFacebookOrganicSync(
  route: AirbyteConnectionRoute,
  onProgress?: (progress: AirbyteRouteProgress) => void,
  dependencies: DirectFacebookDependencies = {},
): Promise<void> {
  const gateway = dependencies.gateway ?? new HubDataGateway(required("DOPA_DATA_GATEWAY_URL"), required("DOPA_DATA_WORKER_TOKEN"));
  const config = dependencies.config ?? await loadMetaConfigFromEnvironment();
  const accountRef = process.env.DOPA_META_FACEBOOK_ACCOUNT_REF ?? "dopa-facebook";
  const account = config.accounts[accountRef];
  if (!account?.facebook_page_id) throw new Error(`Meta account ${accountRef} has no facebook_page_id`);
  const token = process.env[account.access_token_env];
  if (!token) throw new Error(`Missing Meta access token environment variable ${account.access_token_env}`);

  const connectionRef = route.connectionId;
  let runId: string | undefined;
  onProgress?.({ name: route.name, status: "running" });
  try {
    await gateway.health();
    runId = await gateway.start("facebook", connectionRef, 0);
    const records = await readFacebookOrganicPerformance({
      config,
      pageId: account.facebook_page_id,
      token,
      ...(dependencies.fetchImpl ? { fetchImpl: dependencies.fetchImpl } : {}),
      ...(dependencies.now ? { now: dependencies.now } : {}),
    });
    const rowsLoaded = await gateway.upsert("facebook", connectionRef, runId, records);
    await gateway.complete(runId, "succeeded", undefined, rowsLoaded);
    onProgress?.({ name: route.name, status: "succeeded", rowsLoaded });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (runId) await gateway.complete(runId, "failed", message).catch(() => undefined);
    onProgress?.({ name: route.name, status: "failed", error: message });
  }
}

export async function readFacebookOrganicPerformance(input: {
  config: MetaConfigFile;
  pageId: string;
  token: string;
  fetchImpl?: typeof fetch;
  now?: Date;
}): Promise<PerformanceRecord[]> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const base = graphBase(input.config);
  const since = startDate(input.now ?? new Date(), 35);
  const posts = await readAllPages<FacebookPost>(base, `${input.pageId}/posts`, {
    fields: "id,created_time,message,shares,reactions.limit(0).summary(true),comments.limit(0).summary(true)",
    limit: "100",
    since,
  }, input.token, fetchImpl);

  const records: PerformanceRecord[] = [];
  for (const post of posts) {
    const postId = stringValue(post.id);
    const createdTime = stringValue(post.created_time);
    if (!postId || !createdTime) continue;
    const insights = await readAllPages<FacebookInsight>(base, `${postId}/insights`, {
      metric: "post_media_view,post_clicks_by_type,post_reactions_by_type_total",
      period: "lifetime",
      limit: "100",
    }, input.token, fetchImpl);
    const message = stringValue(post.message);
    const fallbackEngagements = numberValue(post.reactions?.summary?.total_count)
      + numberValue(post.comments?.summary?.total_count)
      + numberValue(post.shares?.count);
    const reactions = insightTotal(insights, "post_reactions_by_type_total");
    records.push({
      metric_date: amsterdamDate(new Date(createdTime)),
      placement_key: "facebook_feed_organic",
      external_post_id: postId,
      ...(trackingCode(message) ? { tracking_code: trackingCode(message)! } : {}),
      impressions: 0,
      reach: 0,
      engagements: Math.max(fallbackEngagements, reactions),
      saves: 0,
      clicks: insightTotal(insights, "post_clicks_by_type"),
      video_views: insightTotal(insights, "post_media_view"),
      ad_spend_cents: 0,
      orders: 0,
      revenue_cents: 0,
    });
  }
  return records;
}

async function readAllPages<T>(
  base: URL,
  endpoint: string,
  parameters: Record<string, string>,
  token: string,
  fetchImpl: typeof fetch,
): Promise<T[]> {
  const records: T[] = [];
  let after: string | undefined;
  for (let page = 0; page < 100; page += 1) {
    const url = new URL(endpoint.replace(/^\//, ""), base);
    for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
    if (after) url.searchParams.set("after", after);
    url.searchParams.set("access_token", token);
    const response = await fetchImpl(url, { method: "GET", redirect: "error" });
    const body = await response.json().catch(() => undefined) as GraphPage<T> | undefined;
    if (!response.ok || body?.error) {
      const detail = typeof body?.error?.message === "string" ? safe(body.error.message) : "request failed";
      const code = typeof body?.error?.code === "number" ? ` (code ${body.error.code})` : "";
      throw new Error(`Meta Graph API ${response.status}: ${detail}${code}`);
    }
    if (!body || !Array.isArray(body.data)) throw new Error("Meta Graph API returned an invalid data page");
    records.push(...body.data);
    const nextAfter = body.paging?.cursors?.after;
    if (!body.paging?.next || typeof nextAfter !== "string" || !nextAfter) return records;
    after = nextAfter;
  }
  throw new Error("Meta Graph API pagination exceeded 100 pages");
}

function graphBase(config: MetaConfigFile): URL {
  const root = (config.graph_base_url ?? "https://graph.facebook.com").replace(/\/$/, "");
  return new URL(`${root}/${config.graph_api_version}/`);
}

function insightTotal(insights: readonly FacebookInsight[], name: string): number {
  const insight = insights.find((candidate) => candidate.name === name);
  return sumNumeric(insight?.values?.[0]?.value);
}

function sumNumeric(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.trunc(value));
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.values(value as Record<string, unknown>).reduce<number>((sum, item) => sum + sumNumeric(item), 0);
  }
  return 0;
}

function numberValue(value: unknown): number { return sumNumeric(value); }
function stringValue(value: unknown): string | undefined { return typeof value === "string" && value ? value : undefined; }
function trackingCode(message: string | undefined): string | undefined {
  return message?.match(/(?:code|utm_content)[:= ]+([A-Za-z0-9_-]+)/i)?.[1];
}
function startDate(now: Date, days: number): string {
  const value = new Date(now);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}
function amsterdamDate(value: Date): string {
  if (Number.isNaN(value.getTime())) throw new Error("Meta post has invalid created_time");
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
}
function safe(value: string): string { return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 300); }
function required(name: string): string { const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value; }
