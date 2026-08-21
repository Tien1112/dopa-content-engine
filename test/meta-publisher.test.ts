import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { dispatchDueMetaJobs } from "../src/publishing/meta-dispatch.js";
import { MetaGraphPublisher } from "../src/publishing/meta.js";
import { OutboxPublisherAdapter, listOutboxRecords } from "../src/publishing/outbox.js";
import type { ContentPlanItem } from "../src/publishing/types.js";

function instagramItem(contentType: "feed_post" | "carousel" | "reel" = "feed_post"): ContentPlanItem {
  const video = contentType === "reel";
  return {
    item_id: `instagram-${contentType}`,
    channel: "instagram",
    content_type: contentType,
    account_ref: "dopa-instagram",
    publish_at: "2030-08-21T10:00:00+02:00",
    media: [{ asset_id: "asset-1", file: "asset.png", public_url: video ? "https://cdn.example/reel.mp4" : "https://cdn.example/design.png", mime_type: video ? "video/mp4" : "image/png", width: 1080, height: video ? 1920 : 1350, qa: "passed" }],
    copy: { message: "Caption", hashtags: ["dopa", "adhd"] }
  };
}

function publisher(responses: Array<{ body: unknown; status?: number }>, requests: Array<{ url: string; init?: RequestInit }>): MetaGraphPublisher {
  process.env.DOPA_TEST_META_TOKEN = "private-test-token";
  const fetchMock = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(input), ...(init ? { init } : {}) });
    const response = responses.shift();
    if (!response) throw new Error("Unexpected Meta request");
    return new Response(JSON.stringify(response.body), { status: response.status ?? 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return new MetaGraphPublisher({ graph_api_version: "v25.0", graph_base_url: "https://graph.test", accounts: {
    "dopa-instagram": { access_token_env: "DOPA_TEST_META_TOKEN", instagram_user_id: "ig-user-1" },
    "dopa-facebook": { access_token_env: "DOPA_TEST_META_TOKEN", facebook_page_id: "page-1" }
  } }, fetchMock, async () => undefined);
}

test("Meta adapter publishes one Instagram image using create then publish", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const receipt = await publisher([{ body: { id: "container-1" } }, { body: { id: "post-1" } }], requests).publish(instagramItem());
  assert.equal(receipt.platform_id, "post-1");
  assert.match(requests[0]!.url, /ig-user-1\/media$/);
  assert.match(String(requests[0]!.init?.body), /image_url=https%3A%2F%2Fcdn.example%2Fdesign.png/);
  assert.match(String(requests[0]!.init?.body), /Caption%0A%0A%23dopa\+%23adhd/);
  assert.match(requests[1]!.url, /ig-user-1\/media_publish$/);
});

test("Meta adapter waits for an Instagram Reel container before publishing", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const receipt = await publisher([{ body: { id: "reel-container" } }, { body: { status_code: "IN_PROGRESS" } }, { body: { status_code: "FINISHED" } }, { body: { id: "reel-post" } }], requests).publish(instagramItem("reel"));
  assert.equal(receipt.platform_id, "reel-post");
  assert.equal(requests.filter((request) => request.url.includes("reel-container?")).length, 2);
});

test("Meta adapter publishes a Facebook Page image post", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const item = { ...instagramItem(), item_id: "facebook-feed", channel: "facebook" as const, account_ref: "dopa-facebook" };
  const receipt = await publisher([{ body: { id: "photo-1", post_id: "page-post-1" } }], requests).publish(item);
  assert.equal(receipt.platform_id, "page-post-1");
  assert.match(requests[0]!.url, /page-1\/photos$/);
});

test("Meta adapter refuses local-only media instead of silently posting another asset", async () => {
  const item = instagramItem();
  delete item.media[0]!.public_url;
  await assert.rejects(() => publisher([], []).publish(item), /needs public_url/i);
});

test("due Meta worker records the platform receipt and leaves future jobs alone", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "dopa-meta-worker-"));
  const outbox = path.join(root, "outbox");
  const adapter = new OutboxPublisherAdapter("instagram", outbox);
  const due = instagramItem();
  due.publish_at = "2030-08-21T10:00:00Z";
  const future = { ...instagramItem(), item_id: "future-item", publish_at: "2030-08-23T10:00:00Z" };
  await adapter.schedule(due, { idempotency_key: "plan:due" });
  await adapter.schedule(future, { idempotency_key: "plan:future" });
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const results = await dispatchDueMetaJobs(outbox, publisher([{ body: { id: "container" } }, { body: { id: "post" } }], requests), new Date("2030-08-22T10:00:00Z"));
  assert.equal(results.length, 1);
  assert.equal(results[0]?.status, "dispatched");
  const records = await listOutboxRecords(outbox, "instagram");
  assert.equal(records.filter((record) => record.status === "dispatched").length, 1);
  assert.equal(records.filter((record) => record.status === "awaiting-channel-dispatch").length, 1);
});
