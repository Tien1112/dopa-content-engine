import assert from "node:assert/strict";
import test from "node:test";
import { MetaOrganicCollector } from "../src/analytics/meta-organic.js";

test("collects Facebook organic post reach, engagement and clicks", async () => {
  process.env.TEST_META_ORGANIC = "token";
  const requested: string[] = [];
  const fetcher = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    requested.push(url.pathname + url.search);
    if (url.pathname.endsWith("/page/published_posts")) return response({ data: [{ id: "page_42", created_time: "2030-01-01T10:00:00Z" }] });
    const name = url.searchParams.get("metric")!;
    const values: Record<string, number> = { post_impressions: 100, post_impressions_unique: 80, post_engaged_users: 12, post_clicks: 7, post_video_views: 4 };
    return response({ data: [{ name, values: [{ value: values[name] }] }] });
  }) as typeof fetch;
  const collector = new MetaOrganicCollector(config(), fetcher);
  const rows = await collector.collect("facebook", "facebook");
  assert.equal(rows.length, 1);
  assert.deepEqual({ impressions: rows[0]!.impressions, reach: rows[0]!.reach, engagements: rows[0]!.engagements, clicks: rows[0]!.clicks }, { impressions: 100, reach: 80, engagements: 12, clicks: 7 });
  assert.ok(requested.every((url) => url.includes("access_token=token")));
});

test("collects Instagram organic media and tolerates metrics unsupported for an image", async () => {
  process.env.TEST_META_ORGANIC = "token";
  const fetcher = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/ig/media")) return response({ data: [{ id: "ig_9", media_type: "IMAGE", like_count: 10, comments_count: 2 }] });
    const name = url.searchParams.get("metric")!;
    if (name === "plays") return response({ error: { message: "Metric not supported for this media type", code: 100 } }, 400);
    const values: Record<string, number> = { reach: 90, total_interactions: 15, saved: 2, shares: 1, views: 110 };
    return response({ data: [{ name, values: [{ value: values[name] }] }] });
  }) as typeof fetch;
  const rows = await new MetaOrganicCollector(config(), fetcher).collect("instagram", "instagram");
  assert.equal(rows[0]!.placement_key, "instagram_feed");
  assert.equal(rows[0]!.reach, 90);
  assert.equal(rows[0]!.engagements, 15);
  assert.equal(rows[0]!.saves, 2);
  assert.equal(rows[0]!.video_views, 110);
});

function config() {
  return {
    graph_api_version: "v25.0",
    graph_base_url: "https://graph.test",
    accounts: {
      facebook: { access_token_env: "TEST_META_ORGANIC", facebook_page_id: "page" },
      instagram: { access_token_env: "TEST_META_ORGANIC", instagram_user_id: "ig" },
    },
  };
}

function response(body: unknown, status = 200): Response { return new Response(JSON.stringify(body), { status }); }
