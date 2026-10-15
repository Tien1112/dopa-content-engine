import assert from "node:assert/strict";
import test from "node:test";
import { isDirectFacebookRoute } from "../src/analytics/data-sync-worker.js";

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
