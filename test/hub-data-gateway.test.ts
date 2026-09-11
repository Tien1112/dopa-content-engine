import assert from "node:assert/strict";
import test from "node:test";
import { HubDataGateway } from "../src/analytics/hub-data-gateway.js";

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
