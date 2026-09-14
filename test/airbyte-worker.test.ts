import assert from "node:assert/strict";
import test from "node:test";
import { configuredConnections, hubCompletionStatus } from "../src/analytics/airbyte-worker.js";

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
