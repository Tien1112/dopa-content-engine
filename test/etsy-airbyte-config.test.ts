import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const manifest = readFileSync(resolve("config/airbyte/etsy-manifest.yaml"), "utf8");
const model = readFileSync(resolve("config/bigquery/content-performance.sql"), "utf8");

test("Etsy Airbyte source is read-only and refreshes OAuth safely", () => {
  assert.match(manifest, /name: etsy_shop_receipts/);
  assert.match(manifest, /name: etsy_active_listings/);
  assert.match(manifest, /type: SessionTokenAuthenticator/);
  assert.match(manifest, /url_base: https:\/\/api\.etsy\.com\/v3\/public\//);
  assert.match(manifest, /path: oauth\/token/);
  assert.match(manifest, /grant_type: refresh_token/);
  assert.match(manifest, /type: BearerAuthenticator/);
  assert.match(manifest, /x-api-key: "\{\{ config\['api_key'\] \}\}"/);
  assert.match(manifest, /path: "shops\/\{\{ config\['shop_id'\] \}\}\/receipts"/);
  assert.match(manifest, /type: OffsetIncrement/);
  assert.match(manifest, /field_name: offset/);
  const resourceMethods = [...manifest.matchAll(/path: "shops\/[\s\S]*?http_method: (GET|POST|PATCH|PUT|DELETE)/g)]
    .map((match) => match[1]);
  assert.deepEqual(resourceMethods, ["GET", "GET"]);
  assert.doesNotMatch(manifest, /DOPA_ETSY_(API_KEY|REFRESH_TOKEN)\s*=/);
});

test("canonical performance model includes Etsy gross orders", () => {
  assert.match(model, /etsy_orders AS/);
  assert.match(model, /etsy_shop_receipts/);
  assert.match(model, /'etsy_order' AS placement_key/);
  assert.match(model, /JSON_VALUE\(grandtotal, '\$\.amount'\)/);
  assert.match(model, /UNION ALL SELECT \* FROM etsy_orders/);
});
