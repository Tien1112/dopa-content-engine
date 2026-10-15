import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { buildRemoteDopaServer, createRemoteMcpApp, remoteMcpUrl } from "../src/mcp/remote.js";

const token = "0123456789abcdef0123456789abcdef";
const gatewayToken = "abcdef0123456789abcdef0123456789";
const principal = { urlToken: token, email: "martienvanloo@gmail.com" };

test("remote MCP hides the endpoint and exposes safe Dopa tools", async () => {
  const gatewayCalls: unknown[] = [];
  const fetchImpl: typeof fetch = async (_input, init) => {
    assert.equal(new Headers(init?.headers).get("x-dopa-claude-token"), gatewayToken);
    assert.equal(new Headers(init?.headers).get("x-dopa-actor-email"), principal.email);
    const body = JSON.parse(String(init?.body ?? "{}")) as { action?: string };
    gatewayCalls.push(body);
    return Response.json({ ok: true, action: body.action });
  };
  const app = createRemoteMcpApp({ principals: [principal], gatewayToken, gatewayUrl: "https://gateway.example/api", fetchImpl });
  const httpServer = app.listen(0, "127.0.0.1");
  await once(httpServer, "listening");
  const port = (httpServer.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;

  try {
    const hidden = await fetch(`${base}/mcp/wrong`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(hidden.status, 404);

    const client = new Client({ name: "dopa-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(remoteMcpUrl(base, token)));
    await client.connect(transport as Parameters<Client["connect"]>[0]);

    const listed = await client.listTools();
    assert.ok(listed.tools.some((tool) => tool.name === "dopa_save_plan_channel"));
    assert.ok(listed.tools.some((tool) => tool.name === "dopa_queue_approved_revision"));
    assert.ok(listed.tools.some((tool) => tool.name === "dopa_record_research_signals"));

    const requirements = await client.callTool({ name: "dopa_channel_requirements", arguments: {} });
    assert.match(JSON.stringify(requirements), /channel_requirements/);
    assert.deepEqual(gatewayCalls, [{ action: "channel_requirements" }]);

    const upload = await client.callTool({ name: "dopa_open_new_production", arguments: {} });
    assert.match(JSON.stringify(upload), /dopa-content-hub\.lovable\.app\/nieuwe-productie/);
    await client.close();
  } finally {
    httpServer.close();
    await once(httpServer, "close");
  }
});

test("remote MCP requires a long secret", () => {
  assert.throws(() => createRemoteMcpApp({ principals: [{ ...principal, urlToken: "short" }], gatewayToken }), /at least 32/);
});

test("remote MCP rejects unknown Host headers", async () => {
  const app = createRemoteMcpApp({
    principals: [principal],
    gatewayToken,
    allowedHosts: ["mcp.example"],
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      headers: { host: "attacker.example" },
    });
    assert.equal(response.status, 403);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("30-days prompt explicitly routes through the installed Last30Days skill", async () => {
  const server = buildRemoteDopaServer({
    principals: [principal],
    gatewayToken,
    gatewayUrl: "https://gateway.example/api",
    fetchImpl: async () => Response.json({ ok: true }),
  }, principal);

  // The SDK stores registered prompts internally; this assertion protects the
  // user-facing integration wording without requiring a local listening port.
  const prompt = (server as unknown as { _registeredPrompts: Record<string, { callback: (args: Record<string, string>) => unknown }> })
    ._registeredPrompts.dopa_run_30days_research;
  assert.ok(prompt);
  assert.match(JSON.stringify(prompt.callback({ research_question: "gift trends", market: "Netherlands" })), /Last30Days skill by mvanhorn/);
});

test("remote MCP requires explicit credit confirmation before starting a manual data sync", async () => {
  const calls: Array<{ url: string; authorization: string | null; body: string }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({
      url: String(input),
      authorization: new Headers(init?.headers).get("authorization"),
      body: String(init?.body ?? ""),
    });
    return Response.json({ run: { run_id: "63ed327d-ecce-4af8-b31f-17fc8bd49ca1", status: "running" } }, { status: 202 });
  };
  const server = buildRemoteDopaServer({
    principals: [principal],
    gatewayToken,
    gatewayUrl: "https://gateway.example/api",
    airbyteControlUrl: "http://dopa-airbyte-bridge.railway.internal:8080",
    airbyteControlToken: "fedcba9876543210fedcba9876543210",
    fetchImpl,
  }, principal);
  const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: Record<string, unknown>) => Promise<unknown> }> })._registeredTools;
  assert.ok(tools.dopa_start_manual_data_sync);
  assert.ok(tools.dopa_get_manual_data_sync_status);
  await tools.dopa_start_manual_data_sync.handler({ confirmation: "SYNC NU ALLE DOPA DATA" });
  await tools.dopa_start_manual_data_sync.handler({
    confirmation: "SYNC NU ALLE DOPA DATA",
    sources: ["facebook_organic", "pinterest", "google_analytics", "google_search_console"],
  });
  assert.deepEqual(calls, [{
    url: "http://dopa-airbyte-bridge.railway.internal:8080/sync",
    authorization: "Bearer fedcba9876543210fedcba9876543210",
    body: JSON.stringify({ confirmation: "SYNC NU ALLE DOPA DATA" }),
  }, {
    url: "http://dopa-airbyte-bridge.railway.internal:8080/sync",
    authorization: "Bearer fedcba9876543210fedcba9876543210",
    body: JSON.stringify({
      confirmation: "SYNC NU ALLE DOPA DATA",
      sources: ["facebook_organic", "pinterest", "google_analytics", "google_search_console"],
    }),
  }]);
});
