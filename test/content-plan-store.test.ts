import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildContentPlannerServer } from "../src/mcp/content-planner-server.js";
import { createOutboxAdapters, listOutboxRecords, recordDispatchReceipt } from "../src/publishing/outbox.js";
import { scheduleApprovedPlan } from "../src/publishing/plan.js";
import { ContentPlanStore } from "../src/publishing/store.js";
import type { ContentPlan } from "../src/publishing/types.js";

function draft(revision = 1): ContentPlan {
  return {
    schema_version: 1,
    plan_id: "dopa-week-35",
    revision,
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

test("content-plan store preserves revisions and rejects stale approval", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "dopa-plan-store-"));
  const store = new ContentPlanStore(path.join(root, "plans"));
  await store.createDraft(draft());
  const revision2 = draft(2);
  revision2.items[0]!.copy.message = "Revised caption";
  await store.replaceDraft(revision2);
  await assert.rejects(() => store.approve(revision2.plan_id, 1, "Margot", "2030-08-20T09:00:00+02:00"), /revision changed/i);
  const approved = await store.approve(revision2.plan_id, 2, "Margot", "2030-08-20T09:00:00+02:00");
  assert.equal(approved.status, "approved");
  assert.equal((await store.list())[0]?.revision, 2);
});

test("outbox scheduling is idempotent and writes no live-publish claim", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "dopa-outbox-"));
  const store = new ContentPlanStore(path.join(root, "plans"));
  await store.createDraft(draft());
  const approved = await store.approve("dopa-week-35", 1, "Margot", "2030-08-20T09:00:00+02:00");
  const adapters = createOutboxAdapters(path.join(root, "outbox"));
  const first = await scheduleApprovedPlan(approved, adapters, new Date("2030-08-20T08:00:00Z"));
  const second = await scheduleApprovedPlan(approved, adapters, new Date("2030-08-20T08:00:00Z"));
  assert.deepEqual(second, first);
  const files = await readdir(path.join(root, "outbox", "instagram"));
  assert.equal(files.length, 1);
  const record = JSON.parse(await readFile(path.join(root, "outbox", "instagram", files[0]!), "utf8")) as { status: string };
  assert.equal(record.status, "awaiting-channel-dispatch");
  const queued = await listOutboxRecords(path.join(root, "outbox"), "instagram");
  const dispatched = await recordDispatchReceipt(path.join(root, "outbox"), "instagram", queued[0]!.external_id, "meta-post-123", "2030-08-20T09:05:00+02:00");
  assert.equal(dispatched.status, "dispatched");
  assert.equal(dispatched.platform_receipt?.platform_id, "meta-post-123");
  const duplicate = await recordDispatchReceipt(path.join(root, "outbox"), "instagram", queued[0]!.external_id, "meta-post-123", "2030-08-20T09:06:00+02:00");
  assert.equal(duplicate.platform_receipt?.recorded_at, "2030-08-20T09:05:00+02:00");
});

test("Claude MCP surface requires separate approval and queue confirmations", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "dopa-mcp-plan-"));
  const server = buildContentPlannerServer(path.join(root, "plans"), path.join(root, "outbox"));
  const client = new Client({ name: "dopa-test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const tools = await client.listTools();
    assert.ok(tools.tools.some((tool) => tool.name === "dopa_create_draft_plan"));
    assert.ok(tools.tools.some((tool) => tool.name === "dopa_create_social_preview"));
    assert.ok(tools.tools.some((tool) => tool.name === "dopa_apply_instagram_grid_order"));
    const input = draft();
    const { schema_version: _schema, status: _status, ...draftInput } = input;
    const created = await client.callTool({ name: "dopa_create_draft_plan", arguments: draftInput });
    assert.equal(created.isError, undefined);
    const badApproval = await client.callTool({ name: "dopa_approve_content_plan", arguments: { plan_id: input.plan_id, expected_revision: 1, approved_by: "Margot", confirmation: "yes" } });
    assert.equal(badApproval.isError, true);
    const approved = await client.callTool({ name: "dopa_approve_content_plan", arguments: { plan_id: input.plan_id, expected_revision: 1, approved_by: "Margot", confirmation: "IK KEUR DEZE EXACTE PLANNING GOED" } });
    assert.equal(approved.isError, undefined);
    const queued = await client.callTool({ name: "dopa_queue_approved_plan", arguments: { plan_id: input.plan_id, expected_revision: 1, confirmation: "PLAN NU DEZE EXACTE VERSIE IN" } });
    assert.equal(queued.isError, undefined);
    assert.equal((await readdir(path.join(root, "outbox", "instagram"))).length, 1);
  } finally {
    await client.close();
    await server.close();
  }
});
