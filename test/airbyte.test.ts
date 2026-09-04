import assert from "node:assert/strict";
import test from "node:test";
import { AirbyteClient } from "../src/analytics/airbyte.js";

test("Airbyte client obtains a short-lived token and triggers an exact connection", async () => {
  process.env.TEST_AIRBYTE_CLIENT = "client";
  process.env.TEST_AIRBYTE_SECRET = "secret";
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input); calls.push({ url, init });
    if (url.endsWith("/applications/token")) return new Response(JSON.stringify({ access_token: "short-token" }), { status: 200 });
    return new Response(JSON.stringify({ jobId: 42, status: "pending", connectionId: "18dccc91-0ab1-4f72-9ed7-0b8fc27c5826" }), { status: 200 });
  }) as typeof fetch;
  const client = new AirbyteClient({ client_id_env: "TEST_AIRBYTE_CLIENT", client_secret_env: "TEST_AIRBYTE_SECRET" }, fetcher);
  const result = await client.triggerSync("18dccc91-0ab1-4f72-9ed7-0b8fc27c5826");
  assert.equal(result.jobId, 42);
  assert.deepEqual(calls.map((c) => c.url), ["https://api.airbyte.com/v1/applications/token", "https://api.airbyte.com/v1/jobs"]);
  assert.equal((calls[1]!.init!.headers as Record<string, string>).authorization, "Bearer short-token");
});

test("Airbyte client rejects malformed connection IDs before a sync", async () => {
  const client = new AirbyteClient({ client_id_env: "TEST_AIRBYTE_CLIENT", client_secret_env: "TEST_AIRBYTE_SECRET" });
  await assert.rejects(() => client.triggerSync("not-a-uuid"), /Invalid Airbyte connection ID/);
});
