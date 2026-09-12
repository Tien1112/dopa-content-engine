import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const manifest = readFileSync(resolve("config/airbyte/facebook-organic-manifest.yaml"), "utf8");
const model = readFileSync(resolve("config/bigquery/content-performance.sql"), "utf8");

test("Facebook organic Airbyte manifest keeps posts and insights separate", () => {
  assert.match(manifest, /name: facebook_page_posts/);
  assert.match(manifest, /name: facebook_page_post_insights/);
  assert.match(manifest, /type: SubstreamPartitionRouter/);
  assert.match(manifest, /airbyte_secret: true/);
  assert.doesNotMatch(manifest, /DOPA_META_ACCESS_TOKEN\s*=/);
});

test("canonical performance model includes organic Facebook data", () => {
  assert.match(model, /facebook_post_metrics AS/);
  assert.match(model, /facebook_feed_organic/);
  assert.match(model, /UNION ALL SELECT \* FROM facebook_organic/);
});
