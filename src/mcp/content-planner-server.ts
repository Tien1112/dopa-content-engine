import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import path from "node:path";
import * as z from "zod";
import { applyInstagramGridOrder, createSocialPreview } from "../publishing/feed-preview.js";
import { scheduleApprovedPlan } from "../publishing/plan.js";
import { createOutboxAdapters, listOutboxRecords, recordDispatchReceipt } from "../publishing/outbox.js";
import { ContentPlanStore } from "../publishing/store.js";
import type { ContentPlan } from "../publishing/types.js";

const channelSchema = z.enum(["pinterest", "instagram", "facebook", "google_business_profile", "google_merchant"]);
const contentTypeSchema = z.enum(["pin", "feed_post", "carousel", "story", "reel", "update", "offer", "event", "promotion"]);
const mediaSchema = z.object({
  asset_id: z.string().min(1),
  file: z.string().min(1),
  public_url: z.string().url().optional(),
  mime_type: z.enum(["image/png", "image/jpeg", "video/mp4", "video/webm"]),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  qa: z.literal("passed")
}).strict();
const copySchema = z.object({
  message: z.string().min(1),
  title: z.string().optional(),
  hashtags: z.array(z.string().min(1)).optional(),
  first_comment: z.string().optional(),
  alt_text: z.string().optional(),
  destination_url: z.string().url().optional(),
  call_to_action: z.string().optional()
}).strict();
const itemSchema = z.object({
  item_id: z.string().min(1),
  channel: channelSchema,
  content_type: contentTypeSchema,
  account_ref: z.string().min(1),
  publish_at: z.string().min(1),
  media: z.array(mediaSchema),
  copy: copySchema
}).strict();
const draftSchema = z.object({
  plan_id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/),
  revision: z.number().int().positive(),
  brand: z.string().min(1),
  timezone: z.string().min(1),
  items: z.array(itemSchema).min(1)
}).strict();

export interface ContentPlannerServerOptions {
  previewRoot?: string;
  mediaRoot?: string;
}

export function buildContentPlannerServer(planRoot: string, outboxRoot: string, options: ContentPlannerServerOptions = {}): McpServer {
  const store = new ContentPlanStore(planRoot);
  const previewRoot = options.previewRoot ?? path.join(path.dirname(planRoot), "previews");
  const mediaRoot = options.mediaRoot ?? process.cwd();
  const server = new McpServer({ name: "dopa-content-planner", version: "0.1.0" }, {
    instructions: "Create and revise drafts conversationally. Before approval, offer dopa_create_social_preview for Instagram and Facebook. If Margot copies a chosen newest-first grid order, apply it with dopa_apply_instagram_grid_order and create a fresh preview of the new revision. Never approve without Margot's explicit approval of the exact visible revision. Never queue a plan without a second explicit scheduling instruction. Queued items are handoffs, not proof of live publication."
  });

  server.registerTool("dopa_channel_requirements", {
    title: "Show Dopa channel requirements",
    description: "Use before drafting to learn supported placements, required copy and which connector performs the final dispatch. This tool does not change anything."
  }, async () => result({
    pinterest: { content_types: ["pin"], final_dispatch: "Tailwind MCP in the same Claude conversation", copy: ["title", "message", "alt_text", "destination_url"], note: "Choose a Pinterest board in Tailwind before dispatch." },
    instagram: { content_types: ["feed_post", "carousel", "story", "reel"], proven_live_dispatch: ["feed_post", "carousel", "reel"], final_dispatch: "Dopa Meta Graph adapter (requires Meta connection and public HTTPS media)", copy: ["message", "hashtags", "alt_text", "first_comment"], note: "Story can be planned but live dispatch deliberately fails until proven." },
    facebook: { content_types: ["feed_post", "carousel", "story", "reel"], proven_live_dispatch: ["feed_post"], final_dispatch: "Dopa Meta Graph adapter (requires Meta connection and public HTTPS media)", copy: ["message", "destination_url", "call_to_action"], note: "Carousel, Story and Reel can be planned but live dispatch deliberately fails until proven." },
    google_business_profile: { content_types: ["update", "offer", "event"], final_dispatch: "Dopa Google Business Profile adapter (requires Google OAuth and location)", copy: ["message", "destination_url", "call_to_action"] },
    google_merchant: { content_types: ["promotion"], final_dispatch: "Dopa Merchant adapter (requires Merchant account, promotion data source and Google OAuth)", note: "Merchant promotions are commerce objects and undergo Google review; they are not ordinary social posts." }
  }));

  server.registerTool("dopa_create_draft_plan", {
    title: "Create a Dopa content-plan draft",
    description: "Save a new revision-1 draft after discussing channel-specific captions, titles, hashtags, alt text, links and publication times. This never approves, queues or publishes content.",
    inputSchema: draftSchema
  }, async (input) => result(await store.createDraft(toDraft(input))));

  server.registerTool("dopa_replace_draft_plan", {
    title: "Replace a Dopa draft with a new revision",
    description: "Save the complete revised draft. Revision must be exactly one higher than the current draft. This never approves, queues or publishes content.",
    inputSchema: draftSchema
  }, async (input) => result(await store.replaceDraft(toDraft(input))));

  server.registerTool("dopa_list_content_plans", {
    title: "List Dopa content plans",
    description: "List locally saved plans and their current revision and approval status. This tool does not change anything."
  }, async () => result(await store.list()));

  server.registerTool("dopa_get_content_plan", {
    title: "Read one Dopa content plan",
    description: "Read the exact current revision before asking Margot to approve or schedule it. This tool does not change anything.",
    inputSchema: z.object({ plan_id: z.string().min(1) }).strict()
  }, async ({ plan_id }) => result(await store.get(plan_id)));

  server.registerTool("dopa_create_social_preview", {
    title: "Create a visual Instagram and Facebook preview",
    description: "Generate a local review page for one exact plan revision. Margot can drag Instagram tiles, download or copy the desired order, and review Facebook as a timeline. This never changes, approves, queues or publishes the plan.",
    inputSchema: z.object({
      plan_id: z.string().min(1),
      expected_revision: z.number().int().positive()
    }).strict()
  }, async ({ plan_id, expected_revision }) => {
    const plan = await store.get(plan_id);
    if (plan.revision !== expected_revision) throw new Error(`Plan revision changed: expected ${expected_revision}, current revision is ${plan.revision}`);
    return result(await createSocialPreview(plan, previewRoot, mediaRoot));
  });

  server.registerTool("dopa_apply_instagram_grid_order", {
    title: "Apply an approved Instagram grid order",
    description: "Create a new draft revision from the newest-first Instagram order Margot selected in the visual preview. Internally assigns the existing schedule slots in reverse publication order. This never approves, queues or publishes.",
    inputSchema: z.object({
      plan_id: z.string().min(1),
      expected_revision: z.number().int().positive(),
      newest_first_item_ids: z.array(z.string().min(1)).min(1)
    }).strict()
  }, async ({ plan_id, expected_revision, newest_first_item_ids }) => {
    const plan = await store.get(plan_id);
    if (plan.revision !== expected_revision) throw new Error(`Plan revision changed: expected ${expected_revision}, current revision is ${plan.revision}`);
    const revised = applyInstagramGridOrder(plan, newest_first_item_ids);
    return result(await store.replaceDraft(revised));
  });

  server.registerTool("dopa_approve_content_plan", {
    title: "Approve one exact Dopa plan revision",
    description: "Call only after Margot explicitly approves the exact displayed plan revision. Approval locks captions, hashtags, media, accounts and times. It does not queue or publish.",
    inputSchema: z.object({
      plan_id: z.string().min(1),
      expected_revision: z.number().int().positive(),
      approved_by: z.string().min(1),
      confirmation: z.literal("IK KEUR DEZE EXACTE PLANNING GOED")
    }).strict()
  }, async ({ plan_id, expected_revision, approved_by }) => result(await store.approve(plan_id, expected_revision, approved_by, new Date().toISOString())));

  server.registerTool("dopa_queue_approved_plan", {
    title: "Queue an approved Dopa plan for channel dispatch",
    description: "Call only after approval and a separate explicit instruction from Margot to schedule this exact revision. Creates idempotent outbox jobs; it does not claim that Tailwind, Meta or Google has published them.",
    inputSchema: z.object({
      plan_id: z.string().min(1),
      expected_revision: z.number().int().positive(),
      confirmation: z.literal("PLAN NU DEZE EXACTE VERSIE IN")
    }).strict()
  }, async ({ plan_id, expected_revision }) => {
    const plan = await store.get(plan_id);
    if (plan.revision !== expected_revision) throw new Error(`Plan revision changed: expected ${expected_revision}, current revision is ${plan.revision}`);
    const receipts = await scheduleApprovedPlan(plan, createOutboxAdapters(outboxRoot));
    return result({
      plan_id,
      revision: plan.revision,
      receipts,
      next_actions: {
        pinterest: "Claude calls the connected Tailwind MCP with the exact approved pin job and records Tailwind's receipt.",
        instagram_facebook: "Configure the Dopa Meta Graph adapter, private token environment variable, account IDs, public HTTPS media URLs and a recurring due-job worker before live dispatch.",
        google_business_profile: "Connect Google OAuth and select the Business Profile location before live dispatch.",
        google_merchant: "Connect Merchant Center, select a promotion data source and expect Google review before the promotion becomes live."
      }
    });
  });

  server.registerTool("dopa_list_outbox_jobs", {
    title: "List exact Dopa channel-dispatch jobs",
    description: "Read queued jobs so Claude can hand an approved Pinterest job to Tailwind or report which Meta/Google jobs still need a connected adapter. This tool does not publish.",
    inputSchema: z.object({ channel: channelSchema.optional(), status: z.enum(["awaiting-channel-dispatch", "dispatched"]).optional() }).strict()
  }, async ({ channel, status }) => {
    const records = await listOutboxRecords(outboxRoot, channel);
    return result(status ? records.filter((record) => record.status === status) : records);
  });

  server.registerTool("dopa_record_dispatch_receipt", {
    title: "Record a real Tailwind, Meta or Google receipt",
    description: "Call only after the relevant connector returns a real platform ID. This converts an awaiting outbox job into a dispatched record and never performs the publication itself.",
    inputSchema: z.object({
      channel: channelSchema,
      outbox_external_id: z.string().regex(/^outbox-[a-f0-9]{20}$/),
      platform_id: z.string().min(1)
    }).strict()
  }, async ({ channel, outbox_external_id, platform_id }) => result(await recordDispatchReceipt(outboxRoot, channel, outbox_external_id, platform_id, new Date().toISOString())));

  server.registerPrompt("dopa_plan_campaign", {
    title: "Plan a Dopa campaign safely",
    description: "Conversation starter for Margot to create channel-specific copy and a reviewable draft.",
    argsSchema: { campaign_brief: z.string().min(1) }
  }, ({ campaign_brief }) => ({ messages: [{ role: "user", content: { type: "text", text: `Create a Dopa content plan for this brief: ${campaign_brief}\n\nFirst call dopa_channel_requirements. Discuss and draft channel-specific titles, captions, hashtags, alt text, links, accounts and times. Save only a draft. Show the complete revision to Margot and do not approve or queue anything until she gives the two separate explicit confirmations.` } }] }));

  return server;
}

function toDraft(input: z.infer<typeof draftSchema>): ContentPlan {
  return { schema_version: 1, ...input, status: "draft" } as ContentPlan;
}

function result(value: unknown) {
  const text = JSON.stringify(value, null, 2);
  return { content: [{ type: "text" as const, text }], structuredContent: { result: value } };
}
