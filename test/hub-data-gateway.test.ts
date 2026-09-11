import assert from "node:assert/strict";
import test from "node:test";
import { dedupePerformanceRecords, HubDataGateway } from "../src/analytics/hub-data-gateway.js";

const token = "d".repeat(48);

test("successful ingestion completion omits error_text instead of sending null", async () => {
  let request: Record<string, unknown> | undefined;
  const fakeFetch = async (_input: string | URL | Request, init: RequestInit = {}) => {
    request = JSON.parse(String(init.body)) as Record<string, unknown>;
    return Response.json({ ok: true });
  };
  const gateway = new HubDataGateway("https://dopa.example/api/public/data-worker", token, fakeFetch as typeof fetch);

  await gateway.complete("8ee1eb44-ded4-4c2a-97c7-b0bf1ea08857", "succeeded", undefined, 0);

  assert.deepEqual(request, {
    action: "complete_run",
    run_id: "8ee1eb44-ded4-4c2a-97c7-b0bf1ea08857",
    status: "succeeded",
    rows_loaded: 0
  });
});

test("failed ingestion completion includes a bounded error", async () => {
  let request: Record<string, unknown> | undefined;
  const fakeFetch = async (_input: string | URL | Request, init: RequestInit = {}) => {
    request = JSON.parse(String(init.body)) as Record<string, unknown>;
    return Response.json({ ok: true });
  };
  const gateway = new HubDataGateway("https://dopa.example/api/public/data-worker", token, fakeFetch as typeof fetch);

  await gateway.complete("8ee1eb44-ded4-4c2a-97c7-b0bf1ea08857", "failed", "broken\nsource");

  assert.equal(request?.error_text, "broken source");
});

test("repeated Airbyte snapshots are sent only once per normalized daily key", async () => {
  const batches: Array<Record<string, unknown>> = [];
  const fakeFetch = async (_input: string | URL | Request, init: RequestInit = {}) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    batches.push(body);
    return Response.json({ received: (body.records as unknown[]).length });
  };
  const gateway = new HubDataGateway("https://dopa.example/api/public/data-worker", token, fakeFetch as typeof fetch);
  const duplicate = { metric_date: "2026-09-11", placement_key: "pinterest_account_organic", reach: 0 };

  const loaded = await gateway.upsert(
    "pinterest",
    "1074aac1-6530-4ce1-94bf-5c4c557848a4",
    "8ee1eb44-ded4-4c2a-97c7-b0bf1ea08857",
    [duplicate, duplicate, { ...duplicate, reach: 3 }]
  );

  assert.equal(loaded, 1);
  assert.equal((batches[0]?.records as Array<{ reach: number }>)[0]?.reach, 3);
  assert.equal(dedupePerformanceRecords([duplicate, duplicate]).length, 1);
});
