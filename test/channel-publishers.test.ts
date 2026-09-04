import assert from "node:assert/strict";
import test from "node:test";
import { EtsyPublisher } from "../src/publishing/etsy.js";
import { GoogleBusinessPublisher } from "../src/publishing/google-business.js";
import { PinterestPublisher } from "../src/publishing/pinterest.js";
import type { ContentPlanItem } from "../src/publishing/types.js";

const image = { asset_id: "asset-1", file: "pin.png", public_url: "https://assets.example/pin.png", mime_type: "image/png" as const, width: 1000, height: 1500, qa: "passed" as const };

test("Pinterest publisher sends one approved image Pin to the configured board", async () => {
  process.env.TEST_PINTEREST_TOKEN = "pin-token";
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify({ id: "pin-123", link: "https://pinterest.example/pin-123" }), { status: 201, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const publisher = new PinterestPublisher({ accounts: { dopa: { access_token_env: "TEST_PINTEREST_TOKEN", board_id: "board-1" } } }, fetcher);
  const item: ContentPlanItem = { item_id: "p1", channel: "pinterest", content_type: "pin", account_ref: "dopa", publish_at: "2026-09-10T09:00:00+02:00", media: [image], copy: { title: "Dopa Pin", message: "Beschrijving", alt_text: "Alt", destination_url: "https://dopa.example/product" } };
  const receipt = await publisher.publish(item);
  assert.equal(receipt.platform_id, "pin-123");
  assert.equal(calls[0]!.url, "https://api.pinterest.com/v5/pins");
  const body = JSON.parse(String(calls[0]!.init?.body));
  assert.deepEqual(body.media_source, { source_type: "image_url", url: "https://assets.example/pin.png" });
  assert.equal(body.board_id, "board-1");
});

test("Google Business publisher creates a standard local post with CTA", async () => {
  process.env.TEST_GOOGLE_TOKEN = "google-token";
  let request: { url: string; init: RequestInit | undefined } | undefined;
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    request = { url: String(input), init };
    return new Response(JSON.stringify({ name: "accounts/1/locations/2/localPosts/3", searchUrl: "https://google.example/post/3" }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const publisher = new GoogleBusinessPublisher({ accounts: { dopa: { access_token_env: "TEST_GOOGLE_TOKEN", account_id: "1", location_id: "2" } } }, fetcher);
  const item: ContentPlanItem = { item_id: "g1", channel: "google_business_profile", content_type: "update", account_ref: "dopa", publish_at: "2026-09-10T09:00:00+02:00", media: [image], copy: { message: "Nieuwe Dopa collectie", destination_url: "https://dopa.example/new", call_to_action: "shop" } };
  const receipt = await publisher.publish(item);
  assert.equal(receipt.platform_id, "accounts/1/locations/2/localPosts/3");
  assert.equal(request!.url, "https://mybusiness.googleapis.com/v4/accounts/1/locations/2/localPosts");
  const body = JSON.parse(String(request!.init?.body));
  assert.equal(body.topicType, "STANDARD");
  assert.deepEqual(body.callToAction, { actionType: "SHOP", url: "https://dopa.example/new" });
});

test("Etsy publisher creates draft, uploads approved image and then activates", async () => {
  process.env.TEST_ETSY_KEY = "etsy-key";
  process.env.TEST_ETSY_TOKEN = "etsy-token";
  const calls: string[] = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input); calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url === image.public_url) return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/png", "content-length": "3" } });
    if (url.endsWith("/listings") && init?.method === "POST") return new Response(JSON.stringify({ listing_id: 456, url: "https://etsy.example/listing/456" }), { status: 201, headers: { "content-type": "application/json" } });
    if (url.endsWith("/images")) return new Response(JSON.stringify({ listing_image_id: 789 }), { status: 201, headers: { "content-type": "application/json" } });
    if (url.endsWith("/456") && init?.method === "PATCH") return new Response(JSON.stringify({ listing_id: 456, state: "active" }), { status: 200, headers: { "content-type": "application/json" } });
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  const publisher = new EtsyPublisher({ accounts: { dopa: { api_key_env: "TEST_ETSY_KEY", access_token_env: "TEST_ETSY_TOKEN", shop_id: "123" } } }, fetcher);
  const item: ContentPlanItem = { item_id: "e1", channel: "etsy", content_type: "listing", account_ref: "dopa", publish_at: "2026-09-10T09:00:00+02:00", media: [image], copy: { title: "Dopa kaart", message: "Beschrijving" }, provider_payload: { price: 12.5, quantity: 4, taxonomy_id: 1234, who_made: "i_did", when_made: "2020_2026", is_supply: false, publish: true } };
  const receipt = await publisher.publish(item);
  assert.equal(receipt.platform_id, "456");
  assert.deepEqual(calls, [
    "POST https://openapi.etsy.com/v3/application/shops/123/listings",
    "GET https://assets.example/pin.png",
    "POST https://openapi.etsy.com/v3/application/shops/123/listings/456/images",
    "PATCH https://openapi.etsy.com/v3/application/shops/123/listings/456"
  ]);
});
