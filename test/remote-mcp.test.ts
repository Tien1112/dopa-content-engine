import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createRemoteMcpApp, remoteMcpUrl } from "../src/mcp/remote.js";

const token = "0123456789abcdef0123456789abcdef";
const gatewayToken = "abcdef0123456789abcdef0123456789";

test("remote MCP hides the endpoint and exposes safe Dopa tools", async () => {
  const gatewayCalls: unknown[] = [];
  const fetchImpl: typeof fetch = async (_input, init) => {
    assert.equal(new Headers(init?.headers).get("x-dopa-claude-token"), gatewayToken);
    const body = JSON.parse(String(init?.body ?? "{}")) as { action?: string };
    gatewayCalls.push(body);
    return Response.json({ ok: true, action: body.action });
  };
  const app = createRemoteMcpApp({ mcpUrlToken: token, gatewayToken, gatewayUrl: "https://gateway.example/api", fetchImpl });
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
  assert.throws(() => createRemoteMcpApp({ mcpUrlToken: "short", gatewayToken }), /at least 32/);
});
