import assert from "node:assert/strict";
import test from "node:test";
import { RenderGatewayStore, type PublishedOutput } from "../src/worker/gateway.js";

const token = "a".repeat(48);

test("gateway authenticates health and claim without exposing the token in the body", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const fakeFetch = async (input: string | URL | Request, init: RequestInit = {}) => {
    requests.push({ url: String(input), init });
    const body = JSON.parse(String(init.body)) as { action: string };
    if (body.action === "health") return Response.json({ ok: true, version: 1 });
    return Response.json({ job: null });
  };
  const store = new RenderGatewayStore("https://gateway.example/functions/v1/render-worker", token, fakeFetch as typeof fetch);
  await store.health();
  assert.equal(await store.claimNext(), null);
  const firstRequest = requests[0];
  assert.ok(firstRequest);
  assert.equal(new Headers(firstRequest.init.headers).get("x-dopa-worker-token"), token);
  assert.doesNotMatch(String(firstRequest.init.body), new RegExp(token));
});

test("gateway reserves, uploads and records the exact output", async () => {
  const actions: string[] = [];
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const fakeFetch = async (input: string | URL | Request, init: RequestInit = {}) => {
    if (String(input).includes("upload.example")) {
      actions.push("upload");
      assert.equal(init.method, "PUT");
      assert.deepEqual(Buffer.from(init.body as Uint8Array), png);
      return new Response(null, { status: 200 });
    }
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    actions.push(String(body.action));
    if (body.action === "reserve_output") {
      return Response.json({
        upload_url: "https://upload.example/signed",
        storage_bucket: "canonical-assets",
        storage_path: "workspace/campaign/revision/card.png"
      });
    }
    assert.equal(body.storage_bucket, "canonical-assets");
    assert.equal(body.storage_path, "workspace/campaign/revision/card.png");
    return Response.json({ ok: true });
  };
  const output: PublishedOutput = {
    asset_id: "job-card-instagram-feed",
    design_code: "card",
    format_key: "instagram-feed",
    file_name: "card.png",
    mime_type: "image/png",
    byte_size: png.length,
    width: 1080,
    height: 1350,
    checksum_sha256: "0".repeat(64),
    qa_report: { qa: "passed" }
  };
  const store = new RenderGatewayStore("https://gateway.example/functions/v1/render-worker", token, fakeFetch as typeof fetch);
  await store.publishOutput("job", output, png);
  assert.deepEqual(actions, ["reserve_output", "upload", "record_output"]);
});

test("gateway bounds failure details so Lovable can persist the failed status", async () => {
  let recorded: Record<string, unknown> | undefined;
  const fakeFetch = async (_input: string | URL | Request, init: RequestInit = {}) => {
    recorded = JSON.parse(String(init.body)) as Record<string, unknown>;
    return Response.json({ ok: true });
  };
  const store = new RenderGatewayStore("https://gateway.example/worker", token, fakeFetch as typeof fetch);
  await store.fail("job", "x".repeat(5000));
  assert.equal(recorded?.action, "fail");
  assert.equal(recorded?.job_id, "job");
  assert.equal(String(recorded?.error_text).length, 1000);
});

test("gateway refuses insecure remote URLs and weak tokens", () => {
  assert.throws(() => new RenderGatewayStore("http://gateway.example/worker", token), /HTTPS/);
  assert.throws(() => new RenderGatewayStore("https://gateway.example/worker", "short"), /at least 32/);
});

test("source downloads are bounded and must not be empty", async () => {
  const fakeFetch = async () => new Response(new Uint8Array(), { status: 200 });
  const store = new RenderGatewayStore("https://gateway.example/worker", token, fakeFetch as typeof fetch);
  await assert.rejects(
    store.downloadSource({
      id: "job",
      workspace_id: "workspace",
      campaign_id: "campaign",
      revision_id: "revision",
      source_file_name: "source.zip",
      instruction: null,
      status: "wordt_gerenderd",
      source_download_url: "https://download.example/source.zip"
    }),
    /empty/
  );
});
