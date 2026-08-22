import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseRenderStore } from "../src/worker/supabase.js";

test("claims a queued render job through the atomic database function", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const job = { id: "job-1", workspace_id: "ws", campaign_id: "campaign", revision_id: "revision", source_bucket: "source-packages", source_path: "ws/input.zip", source_file_name: "input.zip", instruction: null, status: "wacht_op_render_engine" };
  const fakeFetch = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), ...(init ? { init } : {}) });
    return new Response(JSON.stringify([job]), { status: 200, headers: { "content-type": "application/json" } });
  };
  const store = new SupabaseRenderStore("https://example.supabase.co", "secret", fakeFetch as typeof fetch);
  assert.deepEqual(await store.claimNext(), job);
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.url, /rpc\/claim_render_job/);
  assert.equal(calls[0]!.init?.method, "POST");
});

test("returns null when the render queue is empty", async () => {
  const fakeFetch = async () => new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  const store = new SupabaseRenderStore("https://example.supabase.co", "secret", fakeFetch as typeof fetch);
  assert.equal(await store.claimNext(), null);
});

test("uses new Supabase secret keys as apikey without an invalid bearer header", async () => {
  let headers: Headers | undefined;
  const fakeFetch = async (_url: string | URL | Request, init?: RequestInit) => {
    headers = new Headers(init?.headers);
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  };
  const store = new SupabaseRenderStore("https://example.supabase.co", "sb_secret_worker", fakeFetch as typeof fetch);
  await store.claimNext();
  assert.equal(headers?.get("apikey"), "sb_secret_worker");
  assert.equal(headers?.get("authorization"), null);
});
