import assert from "node:assert/strict";
import test from "node:test";
import {
  attributionRecords,
  attributionWindow,
  configuredConnections,
  hubCompletionStatus,
} from "../src/analytics/airbyte-worker.js";

const SHOPIFY = "bce72712-f24e-4f0c-a294-1675e13c2c5d";
const META = "48100480-4084-44cc-a01a-ba50e54d04c1";

test("Airbyte route config can split paid Meta data from Instagram organic data", () => {
  const routes = configuredConnections(JSON.stringify([
    { name: "shopify", connection_id: SHOPIFY, imports: [{ provider: "shopify" }] },
    { name: "meta_ads", connection_id: META, imports: [
      { provider: "facebook", scope: "paid" },
      { provider: "instagram", scope: "paid" },
    ] },
  ]));
  assert.deepEqual(routes, [
    { name: "shopify", connectionId: SHOPIFY, imports: [{ provider: "shopify", scope: "all" }] },
    { name: "meta_ads", connectionId: META, imports: [
      { provider: "facebook", scope: "paid" },
      { provider: "instagram", scope: "paid" },
    ] },
  ]);
});

test("legacy Airbyte provider map remains supported", () => {
  assert.deepEqual(configuredConnections(JSON.stringify({ shopify: SHOPIFY })), [
    { name: "shopify", connectionId: SHOPIFY, imports: [{ provider: "shopify", scope: "all" }] },
  ]);
});

test("Airbyte route config rejects invalid IDs and scopes", () => {
  assert.throws(() => configuredConnections('[{"name":"bad","connection_id":"no","imports":[{"provider":"shopify"}]}]'), /Invalid Airbyte connection ID/);
  assert.throws(() => configuredConnections(`[{"name":"bad","connection_id":"${SHOPIFY}","imports":[{"provider":"shopify","scope":"wrong"}]}]`), /Invalid scope/);
});

test("Airbyte incomplete is recorded as a failed Hub run", () => {
  assert.equal(hubCompletionStatus("incomplete"), "failed");
  assert.equal(hubCompletionStatus("cancelled"), "cancelled");
  assert.throws(() => hubCompletionStatus("running"), /not terminal/);
});

test("Shopify orders are aggregated into deterministic UTM last-touch attribution", () => {
  assert.deepEqual(attributionRecords("shopify", [
    { metric_date: "2026-10-14", placement_key: "ig", tracking_code: "dopa-a", orders: 1, revenue_cents: 1299 },
    { metric_date: "2026-10-14", placement_key: "instagram", tracking_code: "dopa-a", orders: 2, revenue_cents: 2500 },
    { metric_date: "2026-10-14", placement_key: "shopify_order", orders: 1, revenue_cents: 999 },
  ]), [{
    period_start: "2026-10-14",
    period_end: "2026-10-14",
    channel: "instagram",
    tracking_code: "dopa-a",
    attributed_orders: 3,
    attributed_revenue_cents: 3799,
    model: "utm_last_touch",
  }]);
});

test("Etsy receipts are attributed to the Etsy marketplace without a UTM code", () => {
  assert.deepEqual(attributionRecords("etsy", [
    { metric_date: "2026-10-13", placement_key: "etsy_order", orders: 1, revenue_cents: 1500 },
  ]), [{
    period_start: "2026-10-13",
    period_end: "2026-10-13",
    channel: "etsy",
    attributed_orders: 1,
    attributed_revenue_cents: 1500,
    model: "marketplace_direct",
  }]);
  assert.deepEqual(attributionWindow(35, new Date("2026-10-15T12:00:00Z")), {
    period_start: "2026-09-10",
    period_end: "2026-10-15",
  });
});
