import assert from "node:assert/strict";
import test from "node:test";
import { configuredDataSyncConnections, isDirectEtsyRoute, isDirectFacebookRoute } from "../src/analytics/data-sync-worker.js";

test("only the dedicated Facebook organic route bypasses Airbyte", () => {
  assert.equal(isDirectFacebookRoute({
    name: "Dopa Facebook Organic",
    connectionId: "8515892f-1372-4d1b-9b29-4b524c61a6f7",
    imports: [{ provider: "facebook", scope: "organic" }],
  }), true);
  assert.equal(isDirectFacebookRoute({
    name: "meta_ads",
    connectionId: "8515892f-1372-4d1b-9b29-4b524c61a6f7",
    imports: [{ provider: "facebook", scope: "paid" }],
  }), false);
});

test("Etsy is added as a direct source when its private config is available", () => {
  const previousConnections = process.env.DOPA_AIRBYTE_CONNECTIONS_JSON;
  const previousEtsy = process.env.DOPA_ETSY_CONFIG_JSON;
  process.env.DOPA_AIRBYTE_CONNECTIONS_JSON = JSON.stringify({ shopify: "bce72712-f24e-4f0c-a294-1675e13c2c5d" });
  process.env.DOPA_ETSY_CONFIG_JSON = JSON.stringify({ accounts: { dopa: {} } });
  try {
    const routes = configuredDataSyncConnections();
    const etsy = routes.find((route) => route.name === "etsy");
    assert.ok(etsy);
    assert.equal(isDirectEtsyRoute(etsy), true);
  } finally {
    if (previousConnections === undefined) delete process.env.DOPA_AIRBYTE_CONNECTIONS_JSON; else process.env.DOPA_AIRBYTE_CONNECTIONS_JSON = previousConnections;
    if (previousEtsy === undefined) delete process.env.DOPA_ETSY_CONFIG_JSON; else process.env.DOPA_ETSY_CONFIG_JSON = previousEtsy;
  }
});
