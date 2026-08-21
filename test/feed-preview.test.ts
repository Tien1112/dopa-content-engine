import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { applyInstagramGridOrder, createSocialPreview } from "../src/publishing/feed-preview.js";
import type { ContentPlan, ContentPlanItem } from "../src/publishing/types.js";

function item(itemId: string, publishAt: string, channel: "instagram" | "facebook" = "instagram"): ContentPlanItem {
  return {
    item_id: itemId,
    channel,
    content_type: "feed_post",
    account_ref: `dopa-${channel}`,
    publish_at: publishAt,
    media: [{ asset_id: `${itemId}-asset`, file: "renders/design.png", mime_type: "image/png", width: 1080, height: 1350, qa: "passed" }],
    copy: { message: `Caption ${itemId}`, hashtags: ["dopa"] }
  };
}

function plan(): ContentPlan {
  return { schema_version: 1, plan_id: "grid-week", revision: 1, brand: "dopa", timezone: "Europe/Amsterdam", status: "draft", items: [
    item("a", "2030-08-21T10:00:00+02:00"),
    item("b", "2030-08-22T10:00:00+02:00"),
    item("c", "2030-08-23T10:00:00+02:00"),
    item("facebook-a", "2030-08-21T11:00:00+02:00", "facebook")
  ] };
}

test("Instagram visual order is converted to reverse chronological publication order", () => {
  const revised = applyInstagramGridOrder(plan(), ["c", "a", "b"]);
  assert.equal(revised.revision, 2);
  const times = Object.fromEntries(revised.items.filter((entry) => entry.channel === "instagram").map((entry) => [entry.item_id, entry.publish_at]));
  assert.equal(times.b, "2030-08-21T10:00:00+02:00");
  assert.equal(times.a, "2030-08-22T10:00:00+02:00");
  assert.equal(times.c, "2030-08-23T10:00:00+02:00");
  assert.deepEqual(revised.items.filter((entry) => entry.channel === "instagram").sort((left, right) => Date.parse(right.publish_at) - Date.parse(left.publish_at)).map((entry) => entry.item_id), ["c", "a", "b"]);
});

test("Instagram reorder rejects incomplete and approved plans", () => {
  assert.throws(() => applyInstagramGridOrder(plan(), ["a", "b"]), /every planned grid item/i);
  const approved = { ...plan(), status: "approved" as const };
  assert.throws(() => applyInstagramGridOrder(approved, ["c", "b", "a"]), /draft/i);
});

test("social preview copies local media and includes draggable Instagram and Facebook views", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "dopa-feed-preview-"));
  await mkdir(path.join(root, "media", "renders"), { recursive: true });
  await writeFile(path.join(root, "media", "renders", "design.png"), "test-image");
  const result = await createSocialPreview(plan(), path.join(root, "previews"), path.join(root, "media"));
  assert.equal(result.instagram_items, 3);
  assert.equal(result.facebook_items, 1);
  const output = await readFile(result.preview_file, "utf8");
  assert.match(output, /draggable="true"/);
  assert.match(output, /Kopieer voor Claude/);
  assert.match(output, /Facebook tijdlijn/);
  assert.match(output, /alleen de geplande posts/i);
});

test("preview refuses media paths outside the configured media root", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "dopa-feed-preview-security-"));
  const unsafe = plan();
  unsafe.items[0]!.media[0]!.file = "../secret.png";
  await assert.rejects(() => createSocialPreview(unsafe, path.join(root, "previews"), path.join(root, "media")), /escapes DOPA_MEDIA_ROOT/i);
});
