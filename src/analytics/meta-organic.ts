import type { MetaAccountDefinition, MetaConfigFile } from "../publishing/meta.js";
import type { OrganicPerformanceRecord } from "./hub-data-gateway.js";

type MetaProvider = "facebook" | "instagram";
type MetricMap = Record<string, number>;

interface MetaList<T> { data?: T[]; error?: { message?: string; code?: number } }
interface Insight { name?: string; values?: Array<{ value?: number | string }> }

/** Reads organic Page and professional Instagram post performance; it never publishes. */
export class MetaOrganicCollector {
  private readonly base: string;
  constructor(private readonly config: MetaConfigFile, private readonly fetchImpl: typeof fetch = fetch) {
    if (!/^v\d+\.\d+$/.test(config.graph_api_version)) throw new Error("Meta graph_api_version must look like v25.0");
    this.base = (config.graph_base_url ?? "https://graph.facebook.com").replace(/\/$/, "");
  }

  async collect(provider: MetaProvider, accountRef: string, days = 30): Promise<OrganicPerformanceRecord[]> {
    const account = this.account(accountRef);
    const token = process.env[account.access_token_env];
    if (!token) throw new Error(`Missing Meta access token environment variable ${account.access_token_env}`);
    const since = new Date(Date.now() - Math.max(1, Math.min(days, 90)) * 86_400_000).toISOString();
    return provider === "facebook"
      ? this.facebook(account, token, since)
      : this.instagram(account, token, since);
  }

  private async facebook(account: MetaAccountDefinition, token: string, since: string): Promise<OrganicPerformanceRecord[]> {
    if (!account.facebook_page_id) throw new Error("Facebook organic analytics needs facebook_page_id");
    const posts = await this.getList<{ id?: string; created_time?: string }>(`${account.facebook_page_id}/published_posts`, {
      fields: "id,created_time", since, limit: "100",
    }, token);
    return Promise.all(posts.filter(validPost).map(async (post) => {
      const metrics = await this.metrics(post.id, ["post_impressions", "post_impressions_unique", "post_engaged_users", "post_clicks", "post_video_views"], token);
      return {
        metric_date: today(), placement_key: "facebook_feed", external_post_id: post.id,
        impressions: metric(metrics, "post_impressions"), reach: metric(metrics, "post_impressions_unique"),
        engagements: metric(metrics, "post_engaged_users"), clicks: metric(metrics, "post_clicks"),
        video_views: metric(metrics, "post_video_views"),
      };
    }));
  }

  private async instagram(account: MetaAccountDefinition, token: string, since: string): Promise<OrganicPerformanceRecord[]> {
    if (!account.instagram_user_id) throw new Error("Instagram organic analytics needs instagram_user_id");
    const media = await this.getList<{ id?: string; timestamp?: string; media_type?: string; like_count?: number; comments_count?: number }>(`${account.instagram_user_id}/media`, {
      fields: "id,timestamp,media_type,like_count,comments_count", since, limit: "100",
    }, token);
    return Promise.all(media.filter(validMedia).map(async (item) => {
      const metrics = await this.metrics(item.id, ["reach", "total_interactions", "saved", "shares", "views", "plays"], token);
      const saves = metric(metrics, "saved");
      const shares = metric(metrics, "shares");
      const fallbackEngagements = (item.like_count ?? 0) + (item.comments_count ?? 0) + saves + shares;
      return {
        metric_date: today(), placement_key: instagramPlacement(item.media_type), external_post_id: item.id,
        reach: metric(metrics, "reach"), engagements: metric(metrics, "total_interactions") || fallbackEngagements,
        saves, video_views: metric(metrics, "views") || metric(metrics, "plays"),
      };
    }));
  }

  /** Meta supports different insight metrics per media type, so query separately and ignore only unsupported metrics. */
  private async metrics(id: string, names: readonly string[], token: string): Promise<MetricMap> {
    const pairs = await Promise.all(names.map(async (name) => {
      try {
        const values = await this.getList<Insight>(`${id}/insights`, { metric: name, period: "lifetime" }, token);
        return [name, numeric(values[0]?.values?.[0]?.value)] as const;
      } catch (error) {
        if (error instanceof UnsupportedMetricError) return [name, 0] as const;
        throw error;
      }
    }));
    return Object.fromEntries(pairs);
  }

  private account(ref: string): MetaAccountDefinition {
    const account = this.config.accounts[ref];
    if (!account) throw new Error(`No Meta account configuration for account_ref ${ref}`);
    return account;
  }

  private async getList<T>(endpoint: string, params: Record<string, string>, token: string): Promise<T[]> {
    const url = new URL(`${this.base}/${this.config.graph_api_version}/${endpoint.replace(/^\//, "")}`);
    for (const [key, value] of Object.entries({ ...params, access_token: token })) url.searchParams.set(key, value);
    const response = await this.fetchImpl(url, { redirect: "error" });
    const body = await response.json().catch(() => undefined) as MetaList<T> | undefined;
    if (!response.ok || body?.error) {
      const message = body?.error?.message ?? "request failed";
      if (/metric|insight|not supported|invalid parameter/i.test(message)) throw new UnsupportedMetricError(message);
      throw new Error(`Meta Graph API ${response.status}: ${message}${body?.error?.code ? ` (code ${body.error.code})` : ""}`);
    }
    return body?.data ?? [];
  }
}

class UnsupportedMetricError extends Error {}
function validPost(value: { id?: string; created_time?: string }): value is { id: string; created_time?: string } { return Boolean(value.id); }
function validMedia(value: { id?: string; timestamp?: string; media_type?: string; like_count?: number; comments_count?: number }): value is { id: string; timestamp?: string; media_type?: string; like_count?: number; comments_count?: number } { return Boolean(value.id); }
function metric(values: MetricMap, name: string): number { return Math.max(0, Math.trunc(values[name] ?? 0)); }
function numeric(value: unknown): number { const number = Number(value ?? 0); return Number.isFinite(number) && number >= 0 ? number : 0; }
function today(): string { return new Date().toISOString().slice(0, 10); }
function instagramPlacement(type?: string): string { return type === "VIDEO" || type === "REELS" ? "instagram_reels" : type === "CAROUSEL_ALBUM" ? "instagram_carousel" : "instagram_feed"; }
