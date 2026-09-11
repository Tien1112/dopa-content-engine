import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { BigQueryPerformanceReader } from "../src/analytics/bigquery.js";

test("BigQuery reader authenticates and converts normalized rows", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input); calls.push({ url, init });
    if (url.includes("oauth2.googleapis.com")) return Response.json({ access_token: "token", expires_in: 3600 });
    return Response.json({
      jobComplete: true,
      schema: { fields: [
        { name: "metric_date" }, { name: "placement_key" }, { name: "external_post_id" },
        { name: "impressions" }, { name: "orders" }, { name: "revenue_cents" },
      ] },
      rows: [{ f: [{ v: "2026-09-10" }, { v: "pinterest_pin" }, { v: "pin-1" }, { v: "125" }, { v: "2" }, { v: "3498" }] }],
    });
  }) as typeof fetch;
  const reader = new BigQueryPerformanceReader("dopa-project", "dopa_airbyte", "content_performance_daily", {
    client_email: "reader@dopa-project.iam.gserviceaccount.com",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  }, fetcher);
  const rows = await reader.read("pinterest", 35, "organic");
  assert.deepEqual(rows, [{ metric_date: "2026-09-10", placement_key: "pinterest_pin", external_post_id: "pin-1", impressions: 125, orders: 2, revenue_cents: 3498 }]);
  assert.equal(calls.length, 2);
  assert.match(String(calls[1]!.init?.body), /content_performance_daily/);
  assert.match(String(calls[1]!.init?.body), /ENDS_WITH\(placement_key, '_organic'\)/);
  assert.match(String(calls[1]!.init?.body), /"value":"organic"/);
  assert.equal((calls[1]!.init?.headers as Record<string, string>).authorization, "Bearer token");
});

test("BigQuery reader rejects unsafe identifiers", () => {
  assert.throws(() => new BigQueryPerformanceReader("project`, evil", "dataset", "table", {
    client_email: "reader@example.com", private_key: "not-used",
  }), /Invalid BigQuery project identifier/);
});
