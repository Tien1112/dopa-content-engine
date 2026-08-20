import assert from "node:assert/strict";
import test from "node:test";
import { approveContentPlan, scheduleApprovedPlan, validateContentPlan } from "../src/publishing/plan.js";
import type { ContentPlan, PublisherAdapter, PublishingChannel } from "../src/publishing/types.js";

function draftPlan(): ContentPlan {
  return {
    schema_version: 1,
    plan_id: "dopa-week-35",
    revision: 1,
    brand: "dopa",
    timezone: "Europe/Amsterdam",
    status: "draft",
    items: [{
      item_id: "wild-instagram-01",
      channel: "instagram",
      content_type: "feed_post",
      account_ref: "dopa-instagram",
      publish_at: "2030-08-26T10:00:00+02:00",
      media: [{ asset_id: "wild-4x5", file: "renders/wild-instagram.png", mime_type: "image/png", width: 1080, height: 1350, qa: "passed" }],
      copy: { message: "A little wild, a little loud.", hashtags: ["dopadispatch", "adhd"], alt_text: "Dopa quote design" }
    }]
  };
}

test("draft plans cannot be scheduled", async () => {
  await assert.rejects(() => scheduleApprovedPlan(draftPlan(), []), /must be approved/);
});

test("assets that failed render QA are rejected", () => {
  const plan = draftPlan();
  plan.items[0]!.media[0]!.qa = "failed";
  assert.match(validateContentPlan(plan).join("\n"), /has not passed render QA/);
});

test("content type must match its target channel", () => {
  const plan = draftPlan();
  plan.items[0]!.channel = "pinterest";
  assert.match(validateContentPlan(plan).join("\n"), /feed_post is not supported for pinterest/);
});

test("an explicitly approved plan is routed with a stable idempotency key", async () => {
  const calls: string[] = [];
  const adapter: PublisherAdapter = {
    channel: "instagram",
    async schedule(item, context) {
      calls.push(`${item.item_id}:${context.idempotency_key}`);
      return { external_id: "meta-123" };
    }
  };
  const approved = approveContentPlan(draftPlan(), { approved_by: "Margot", approved_at: "2030-08-20T09:00:00+02:00" });
  const receipts = await scheduleApprovedPlan(approved, [adapter], new Date("2030-08-20T08:00:00Z"));
  assert.deepEqual(receipts, [{ item_id: "wild-instagram-01", channel: "instagram", status: "queued", external_id: "meta-123" }]);
  assert.deepEqual(calls, ["wild-instagram-01:dopa-week-35:wild-instagram-01"]);
});

test("a missing channel adapter fails only that item", async () => {
  const plan = draftPlan();
  plan.items.push({
    ...plan.items[0]!,
    item_id: "wild-facebook-01",
    channel: "facebook" as PublishingChannel,
    account_ref: "dopa-facebook"
  });
  const adapter: PublisherAdapter = { channel: "instagram", async schedule() { return { external_id: "meta-123" }; } };
  const approved = approveContentPlan(plan, { approved_by: "Margot", approved_at: "2030-08-20T09:00:00+02:00" });
  const receipts = await scheduleApprovedPlan(approved, [adapter], new Date("2030-08-20T08:00:00Z"));
  assert.equal(receipts[0]!.status, "queued");
  assert.deepEqual(receipts[1], { item_id: "wild-facebook-01", channel: "facebook", status: "failed", error: "No publisher adapter configured for facebook" });
});

test("changing copy after approval invalidates the approval", async () => {
  const approved = approveContentPlan(draftPlan(), { approved_by: "Margot", approved_at: "2030-08-20T09:00:00+02:00" });
  approved.items[0]!.copy.message = "A different caption";
  await assert.rejects(() => scheduleApprovedPlan(approved, []), /no longer matches its approval hash/);
});
