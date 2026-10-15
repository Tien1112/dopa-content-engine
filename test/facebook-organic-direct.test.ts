import assert from "node:assert/strict";
import test from "node:test";
import { readFacebookOrganicPerformance, runDirectFacebookOrganicSync } from "../src/analytics/facebook-organic-direct.js";
import { HubDataGateway } from "../src/analytics/hub-data-gateway.js";
import type { MetaConfigFile } from "../src/publishing/meta.js";

const config: MetaConfigFile = {
  graph_api_version: "v25.0",
  accounts: {
    "dopa-facebook": { access_token_env: "DOPA_TEST_FACEBOOK_TOKEN", facebook_page_id: "page-1" },
  },
};

test("direct Facebook reader paginates posts and normalizes current v25 insights", async () => {
  const requested: URL[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(String(input));
    requested.push(url);
    if (url.pathname.endsWith("/page-1/posts") && !url.searchParams.has("after")) {
      return Response.json({
        data: [{
          id: "page-1_100",
          created_time: "2026-10-14T23:30:00+0000",
          message: "nieuwe post code: CAMPAGNE_1",
          reactions: { summary: { total_count: 4 } },
          comments: { summary: { total_count: 2 } },
          shares: { count: 1 },
        }],
        paging: { cursors: { after: "cursor-1" }, next: "https://graph.facebook.com/next" },
      });
    }
    if (url.pathname.endsWith("/page-1/posts")) return Response.json({ data: [] });
    if (url.pathname.endsWith("/page-1_100/insights")) {
      return Response.json({ data: [
        { name: "post_media_view", values: [{ value: 9 }] },
        { name: "post_clicks_by_type", values: [{ value: { link_clicks: 3, other_clicks: 2 } }] },
        { name: "post_reactions_by_type_total", values: [{ value: { like: 4, love: 1 } }] },
      ] });
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  const rows = await readFacebookOrganicPerformance({
    config,
    pageId: "page-1",
    token: "private-token",
    fetchImpl,
    now: new Date("2026-10-15T12:00:00Z"),
  });
  assert.deepEqual(rows, [{
    metric_date: "2026-10-15",
    placement_key: "facebook_feed_organic",
    external_post_id: "page-1_100",
    tracking_code: "CAMPAGNE_1",
    impressions: 0,
    reach: 0,
    engagements: 7,
    saves: 0,
    clicks: 5,
    video_views: 9,
    ad_spend_cents: 0,
    orders: 0,
    revenue_cents: 0,
  }]);
  assert.equal(requested[0]!.searchParams.get("since"), "2026-09-10");
  assert.equal(requested[1]!.searchParams.get("after"), "cursor-1");
  assert.ok(requested.every((url) => url.searchParams.get("access_token") === "private-token"));
});

test("direct Facebook worker writes one audited Hub run without Airbyte", async () => {
  const previous = process.env.DOPA_TEST_FACEBOOK_TOKEN;
  process.env.DOPA_TEST_FACEBOOK_TOKEN = "private-token";
  const gatewayActions: Array<Record<string, unknown>> = [];
  const gateway = new HubDataGateway(
    "https://hub.example/data",
    "0123456789abcdef0123456789abcdef",
    async (_input, init) => {
      const action = JSON.parse(String(init?.body)) as Record<string, unknown>;
      gatewayActions.push(action);
      if (action.action === "health") return Response.json({ ok: true, version: 1 });
      if (action.action === "start_run") return Response.json({ run_id: "run-1" });
      if (action.action === "upsert_performance") return Response.json({ received: 1 });
      return Response.json({ ok: true });
    },
  );
  const progress: string[] = [];
  try {
    await runDirectFacebookOrganicSync({
      name: "facebook_organic",
      connectionId: "8515892f-1372-4d1b-9b29-4b524c61a6f7",
      imports: [{ provider: "facebook", scope: "organic" }],
    }, (value) => progress.push(value.status), {
      gateway,
      config,
      now: new Date("2026-10-15T12:00:00Z"),
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/page-1/posts")) return Response.json({ data: [{ id: "post-1", created_time: "2026-10-15T08:00:00Z" }] });
        return Response.json({ data: [] });
      },
    });
  } finally {
    if (previous === undefined) delete process.env.DOPA_TEST_FACEBOOK_TOKEN;
    else process.env.DOPA_TEST_FACEBOOK_TOKEN = previous;
  }
  assert.deepEqual(progress, ["running", "succeeded"]);
  assert.deepEqual(gatewayActions.map((value) => value.action), ["health", "start_run", "upsert_performance", "complete_run"]);
  assert.equal(gatewayActions[1]!.airbyte_job_id, 0);
  assert.equal(gatewayActions[3]!.rows_loaded, 1);
});

test("Meta errors are sanitized and never echo the access token", async () => {
  await assert.rejects(readFacebookOrganicPerformance({
    config,
    pageId: "page-1",
    token: "do-not-leak-this-token",
    fetchImpl: async () => Response.json({ error: { message: "token rejected\nretry", code: 190 } }, { status: 401 }),
  }), (error: Error) => {
    assert.match(error.message, /Meta Graph API 401: token rejected retry \(code 190\)/);
    assert.doesNotMatch(error.message, /do-not-leak/);
    return true;
  });
});
