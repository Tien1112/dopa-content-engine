import assert from "node:assert/strict";
import test from "node:test";
import { readPinterestPerformance, runDirectPinterestSync } from "../src/analytics/pinterest-direct.js";
import { HubDataGateway } from "../src/analytics/hub-data-gateway.js";
import type { PinterestConfig } from "../src/publishing/pinterest.js";

const config: PinterestConfig = {
  accounts: { dopa: { access_token_env: "DOPA_TEST_PINTEREST_TOKEN", board_id: "board-1" } },
};

test("direct Pinterest reader normalizes daily Pin analytics", async () => {
  const previous = process.env.DOPA_TEST_PINTEREST_TOKEN;
  process.env.DOPA_TEST_PINTEREST_TOKEN = "private-token";
  const requested: URL[] = [];
  try {
    const records = await readPinterestPerformance({
      config,
      account: config.accounts.dopa!,
      now: new Date("2026-10-15T12:00:00Z"),
      fetchImpl: async (input, init) => {
        const url = new URL(String(input));
        requested.push(url);
        assert.equal((init?.headers as Record<string, string>).authorization, "Bearer private-token");
        if (url.pathname.endsWith("/v5/pins")) return Response.json({ items: [{ id: "pin-1" }], bookmark: null });
        if (url.pathname.endsWith("/v5/pins/pin-1/analytics")) return Response.json({
          ALL: { daily_metrics: [{ date: "2026-10-14", metrics: { IMPRESSION: 120, SAVE: 4, PIN_CLICK: 7, OUTBOUND_CLICK: 3, VIDEO_MRC_VIEW: 2 } }] },
        });
        throw new Error(`Unexpected URL ${url}`);
      },
    });
    assert.deepEqual(records, [{
      metric_date: "2026-10-14", placement_key: "pinterest_pin_organic", external_post_id: "pin-1",
      impressions: 120, reach: 0, engagements: 14, saves: 4, clicks: 3, video_views: 2,
      ad_spend_cents: 0, orders: 0, revenue_cents: 0,
    }]);
    const analytics = requested[1]!;
    assert.equal(analytics.searchParams.get("start_date"), "2026-09-11");
    assert.equal(analytics.searchParams.get("end_date"), "2026-10-15");
    assert.equal(analytics.searchParams.get("metric_types"), "IMPRESSION,SAVE,PIN_CLICK,OUTBOUND_CLICK,VIDEO_MRC_VIEW");
  } finally {
    if (previous === undefined) delete process.env.DOPA_TEST_PINTEREST_TOKEN; else process.env.DOPA_TEST_PINTEREST_TOKEN = previous;
  }
});

test("direct Pinterest worker writes one audited Hub run without Airbyte", async () => {
  const previous = process.env.DOPA_TEST_PINTEREST_TOKEN;
  process.env.DOPA_TEST_PINTEREST_TOKEN = "private-token";
  const actions: Array<Record<string, unknown>> = [];
  const gateway = new HubDataGateway("https://hub.example/data", "0123456789abcdef0123456789abcdef", async (_input, init) => {
    const action = JSON.parse(String(init?.body)) as Record<string, unknown>;
    actions.push(action);
    if (action.action === "health") return Response.json({ ok: true, version: 1 });
    if (action.action === "start_run") return Response.json({ run_id: "run-pinterest" });
    if (action.action === "upsert_performance") return Response.json({ received: 1 });
    return Response.json({ ok: true });
  });
  const progress: string[] = [];
  try {
    await runDirectPinterestSync({ name: "pinterest", connectionId: "airbyte-id-kept-for-audit", imports: [{ provider: "pinterest", scope: "all" }] },
      (value) => progress.push(value.status), {
        gateway, config, now: new Date("2026-10-15T12:00:00Z"),
        fetchImpl: async (input) => new URL(String(input)).pathname.endsWith("/v5/pins")
          ? Response.json({ items: [{ id: "pin-1" }], bookmark: null })
          : Response.json({ ALL: { daily_metrics: [{ date: "2026-10-15", metrics: { IMPRESSION: 1 } }] } }),
      });
  } finally {
    if (previous === undefined) delete process.env.DOPA_TEST_PINTEREST_TOKEN; else process.env.DOPA_TEST_PINTEREST_TOKEN = previous;
  }
  assert.deepEqual(progress, ["running", "succeeded"]);
  assert.deepEqual(actions.map((value) => value.action), ["health", "start_run", "upsert_performance", "complete_run"]);
  assert.equal(actions[1]!.airbyte_job_id, 0);
  assert.equal(actions[3]!.rows_loaded, 1);
});

test("Pinterest errors are sanitized and never echo tokens", async () => {
  const previous = process.env.DOPA_TEST_PINTEREST_TOKEN;
  process.env.DOPA_TEST_PINTEREST_TOKEN = "do-not-leak-this-token";
  try {
    await assert.rejects(readPinterestPerformance({
      config, account: config.accounts.dopa!, fetchImpl: async () => Response.json({ message: "token rejected\nretry" }, { status: 401 }),
    }), (error: Error) => {
      assert.match(error.message, /Pinterest API 401: token rejected retry/);
      assert.doesNotMatch(error.message, /do-not-leak/);
      return true;
    });
  } finally {
    if (previous === undefined) delete process.env.DOPA_TEST_PINTEREST_TOKEN; else process.env.DOPA_TEST_PINTEREST_TOKEN = previous;
  }
});
