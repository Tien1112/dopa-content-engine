import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { listenAirbyteControl } from "../src/analytics/airbyte-control.js";

test("Airbyte control hides unauthorized requests and rejects missing credit confirmation", async () => {
  const previous = process.env.DOPA_AIRBYTE_CONTROL_TOKEN;
  process.env.DOPA_AIRBYTE_CONTROL_TOKEN = "0123456789abcdef0123456789abcdef";
  const server = listenAirbyteControl(0);
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  try {
    const unauthorized = await fetch(`http://127.0.0.1:${port}/sync`, { method: "POST" });
    assert.equal(unauthorized.status, 404);
    const invalid = await fetch(`http://127.0.0.1:${port}/sync`, {
      method: "POST",
      headers: {
        authorization: "Bearer 0123456789abcdef0123456789abcdef",
        "content-type": "application/json",
      },
      body: JSON.stringify({ confirmation: "yes" }),
    });
    assert.equal(invalid.status, 400);
    assert.match(await invalid.text(), /SYNC NU ALLE DOPA DATA/);
  } finally {
    server.close();
    await once(server, "close");
    if (previous === undefined) delete process.env.DOPA_AIRBYTE_CONTROL_TOKEN;
    else process.env.DOPA_AIRBYTE_CONTROL_TOKEN = previous;
  }
});
