import assert from "node:assert/strict";
import test from "node:test";
import { readEtsyPerformance, runDirectEtsySync } from "../src/analytics/etsy-direct.js";
import { HubDataGateway } from "../src/analytics/hub-data-gateway.js";
import type { EtsyConfig } from "../src/publishing/etsy.js";

const config: EtsyConfig = {
  accounts: {
    dopa: {
      api_key_env: "DOPA_TEST_ETSY_API_KEY",
      client_id_env: "DOPA_TEST_ETSY_CLIENT_ID",
      refresh_token_env: "DOPA_TEST_ETSY_REFRESH_TOKEN",
      shop_id: "65968226",
    },
  },
};

test("direct Etsy reader refreshes OAuth and normalizes receipts and active listings", async () => {
  const previous = setEtsyTestEnvironment();
  const requested: URL[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(String(input));
    requested.push(url);
    if (url.pathname.endsWith("/oauth/token")) return Response.json({ access_token: "short-lived" });
    if (url.pathname.endsWith("/receipts")) return Response.json({
      count: 2,
      results: [
        { receipt_id: 101, status: "paid", is_paid: true, create_timestamp: 1792051200, grandtotal: { amount: 1299, divisor: 100 }, transactions: [{ listing_id: 501 }] },
        { receipt_id: 102, status: "fully refunded", is_paid: true, create_timestamp: 1792051200, grandtotal: { amount: 999, divisor: 100 } },
      ],
    });
    if (url.pathname.endsWith("/listings")) return Response.json({
      count: 1,
      results: [{ listing_id: 501, state: "active", views: 42, num_favorers: 6, creation_timestamp: 1791964800, updated_timestamp: 1792051200 }],
    });
    throw new Error(`Unexpected URL ${url}`);
  };
  try {
    const records = await readEtsyPerformance({ config, account: config.accounts.dopa!, fetchImpl, now: new Date("2026-10-15T12:00:00Z") });
    assert.deepEqual(records, [{
      metric_date: "2026-10-15", placement_key: "etsy_order", external_post_id: "101", product_ref: "501",
      impressions: 0, reach: 0, engagements: 0, saves: 0, clicks: 0, video_views: 0, ad_spend_cents: 0,
      orders: 1, revenue_cents: 1299,
    }, {
      metric_date: "2026-10-15", placement_key: "etsy_listing_organic", external_post_id: "501", product_ref: "501",
      impressions: 42, reach: 0, engagements: 6, saves: 6, clicks: 0, video_views: 0, ad_spend_cents: 0,
      orders: 0, revenue_cents: 0,
    }]);
    const receipts = requested.find((url) => url.pathname.endsWith("/receipts"))!;
    assert.equal(receipts.searchParams.get("min_created"), "1789041600");
  } finally { restoreEnvironment(previous); }
});

test("direct Etsy worker writes performance and marketplace attribution in one audited run", async () => {
  const previous = setEtsyTestEnvironment();
  const actions: Array<Record<string, unknown>> = [];
  const gateway = new HubDataGateway("https://hub.example/data", "0123456789abcdef0123456789abcdef", async (_input, init) => {
    const action = JSON.parse(String(init?.body)) as Record<string, unknown>;
    actions.push(action);
    if (action.action === "health") return Response.json({ ok: true, version: 1 });
    if (action.action === "start_run") return Response.json({ run_id: "run-etsy" });
    if (action.action === "upsert_performance") return Response.json({ received: 1 });
    if (action.action === "replace_attribution") return Response.json({ received: 1 });
    return Response.json({ ok: true });
  });
  const progress: string[] = [];
  try {
    await runDirectEtsySync({ name: "etsy", connectionId: "direct-etsy", imports: [{ provider: "etsy", scope: "all" }] },
      (value) => progress.push(value.status), {
        gateway, config, now: new Date("2026-10-15T12:00:00Z"),
        fetchImpl: async (input) => {
          const url = new URL(String(input));
          if (url.pathname.endsWith("/oauth/token")) return Response.json({ access_token: "short-lived" });
          if (url.pathname.endsWith("/receipts")) return Response.json({ count: 1, results: [{ receipt_id: 101, status: "paid", is_paid: true, create_timestamp: 1792051200, grandtotal: { amount: 1299, divisor: 100 } }] });
          return Response.json({ count: 0, results: [] });
        },
      });
  } finally { restoreEnvironment(previous); }
  assert.deepEqual(progress, ["running", "succeeded"]);
  assert.deepEqual(actions.map((value) => value.action), ["health", "start_run", "upsert_performance", "replace_attribution", "complete_run"]);
  assert.equal((actions[3]!.records as unknown[]).length, 1);
});

test("Etsy OAuth errors are bounded and do not echo refresh tokens", async () => {
  const previous = setEtsyTestEnvironment();
  try {
    await assert.rejects(readEtsyPerformance({
      config, account: config.accounts.dopa!, fetchImpl: async () => Response.json({ error: "invalid_grant\nexpired" }, { status: 400 }),
    }), (error: Error) => {
      assert.match(error.message, /Etsy OAuth refresh failed \(400\): invalid_grant expired/);
      assert.doesNotMatch(error.message, /refresh-secret/);
      return true;
    });
  } finally { restoreEnvironment(previous); }
});

function setEtsyTestEnvironment(): Record<string, string | undefined> {
  const names = ["DOPA_TEST_ETSY_API_KEY", "DOPA_TEST_ETSY_CLIENT_ID", "DOPA_TEST_ETSY_REFRESH_TOKEN"];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  process.env.DOPA_TEST_ETSY_API_KEY = "key:secret";
  process.env.DOPA_TEST_ETSY_CLIENT_ID = "client-id";
  process.env.DOPA_TEST_ETSY_REFRESH_TOKEN = "refresh-secret";
  return previous;
}
function restoreEnvironment(previous: Record<string, string | undefined>): void {
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
}
