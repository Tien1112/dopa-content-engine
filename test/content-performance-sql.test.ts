import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

test("BigQuery normalization includes content-level Search Console evidence", async () => {
  const sql = await readFile(resolve("config/bigquery/content-performance.sql"), "utf8");

  assert.match(sql, /google_search_console AS \(/);
  assert.match(sql, /search_analytics_all_fields/);
  assert.match(sql, /GROUP BY date, page, query/);
  assert.match(sql, /'google_search_console_organic' AS placement_key/);
  assert.match(sql, /NULLIF\(query, ''\) AS tracking_code/);
  assert.match(sql, /NULLIF\(page, ''\) AS product_ref/);
  assert.match(sql, /UNION ALL SELECT \* FROM google_search_console/);
});
