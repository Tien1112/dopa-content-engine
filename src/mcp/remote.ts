import { timingSafeEqual } from "node:crypto";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Request, Response } from "express";
import * as z from "zod";

const DEFAULT_GATEWAY = "https://dopa-content-hub.lovable.app/api/public/claude-connector";
const CONFIRMATION = "PLAN NU DEZE EXACTE VERSIE IN" as const;

const channelSchema = z.enum(["instagram", "facebook", "pinterest", "story"]);
const placementSchema = z.enum([
  "instagram_feed", "instagram_square", "instagram_story", "instagram_reel",
  "facebook_feed", "facebook_landscape", "facebook_story", "facebook_reel",
  "pinterest_standard", "etsy_listing_landscape", "etsy_listing_square",
  "google_business_standard",
]);
const plannedPostSchema = z.object({
  id: z.string().trim().min(1).max(120),
  design: z.string().trim().min(1).max(80),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  caption: z.string().max(5000),
  title: z.string().trim().max(200).optional(),
  alt_text: z.string().trim().max(1000).optional(),
  hashtags: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  destination_url: z.string().url().optional(),
  product_ref: z.string().trim().max(120).optional(),
  provider_payload: z.record(z.string(), z.unknown()).optional(),
}).strict();

export interface RemoteMcpOptions {
  /** Secret embedded only in the Claude connector URL. */
  mcpUrlToken: string;
  /** Separate server-to-server secret shared only by Railway and Lovable. */
  gatewayToken: string;
  gatewayUrl?: string;
  fetchImpl?: typeof fetch;
}

export function buildRemoteDopaServer(options: RemoteMcpOptions): McpServer {
  const gateway = new DopaGateway(options);
  const server = new McpServer(
    { name: "dopa-content-engine", version: "0.2.0" },
    {
      instructions:
        "The connected conversation client (Claude or ChatGPT) is the strategic control layer. Combine measured performance, 30-days research signals and user-supplied thoughts or transcripts to propose strategies, campaigns and content briefs. Never create images or animations: the user creates those in Claude Design and uploads them to Lovable for rendering, review and planning. Never describe an internal queue as proof of live publication and never queue without the user's separate explicit confirmation.",
    },
  );

  server.registerTool("dopa_channel_requirements", {
    title: "Show Dopa channel requirements",
    description: "Read proven placements and the real final dispatch route before drafting. Does not change data.",
  }, async () => toolResult(await gateway.call("channel_requirements")));

  server.registerTool("dopa_get_learning_snapshot", {
    title: "Read Dopa evidence for content strategy",
    description: "Read measured performance, commerce attribution, 30-days research signals and user-supplied conversation context. Use it to propose strategies and campaign briefs, never to manufacture assets.",
    inputSchema: { days: z.number().int().min(1).max(90).default(30) },
  }, async ({ days }) => toolResult(await gateway.call("get_learning_snapshot", { days })));

  server.registerTool("dopa_record_user_input", {
    title: "Remember Dopa strategy input from this conversation",
    description: "Store a thought, sales note, call transcript or website reference supplied by the user so it can inform later strategy. This never creates, plans or publishes content.",
    inputSchema: {
      input_type: z.enum(["thought", "call_transcript", "sales_note", "website", "other"]),
      title: z.string().trim().min(2).max(200),
      content: z.string().trim().min(2).max(50_000),
      source_url: z.string().url().optional(),
      occurred_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    },
  }, async (input) => toolResult(await gateway.call("record_user_input", input)));

  server.registerTool("dopa_list_render_jobs", {
    title: "List Dopa productions",
    description: "List Dopa render jobs, QA counts and their Lovable review links. Does not expose storage credentials or change data.",
  }, async () => toolResult(await gateway.call("list_render_jobs")));

  server.registerTool("dopa_get_render_job", {
    title: "Read one Dopa production",
    description: "Read exact asset metadata and the Lovable review link for one production. Downloads and visual approval remain in Lovable.",
    inputSchema: { job_id: z.string().uuid() },
  }, async ({ job_id }) => toolResult(await gateway.call("get_render_job", { job_id })));

  server.registerTool("dopa_open_new_production", {
    title: "Open Dopa production intake",
    description: "Return the fixed Lovable upload page where an approved Claude Design ZIP can be submitted to the deterministic renderer.",
  }, async () => toolResult({
    upload_url: "https://dopa-content-hub.lovable.app/nieuwe-productie",
    instruction: "Open this page, upload the complete Claude Design ZIP, submit it, then ask Claude to list Dopa productions.",
  }));

  server.registerTool("dopa_get_content_plan", {
    title: "Read the Dopa content plan",
    description: "Read the exact persistent plan that is also visible in Lovable. This does not approve, queue or publish.",
    inputSchema: { campaign_slug: z.string().trim().min(1).max(120).default("dopa-quotes-week-36") },
  }, async ({ campaign_slug }) => toolResult(await gateway.call("get_plan", { campaign_slug })));

  server.registerTool("dopa_save_plan_channel", {
    title: "Save one Dopa channel draft",
    description: "Replace one complete channel draft after discussing copy, hashtags/order and times. Saves persistent draft data only; approval and publishing remain separate.",
    inputSchema: {
      campaign_slug: z.string().trim().min(1).max(120).default("dopa-quotes-week-36"),
      channel: channelSchema,
      expected_revision_id: z.string().uuid(),
      posts: z.array(plannedPostSchema).max(60),
    },
  }, async (input) => toolResult(await gateway.call("save_plan_channel", input)));

  server.registerTool("dopa_save_plan_placement", {
    title: "Save one exact Dopa placement draft",
    description: "Replace one complete placement draft, including Etsy listing fields where applicable. Saves persistent draft data only; approval and publishing remain separate.",
    inputSchema: {
      campaign_slug: z.string().trim().min(1).max(120).default("dopa-quotes-week-36"),
      placement_key: placementSchema,
      expected_revision_id: z.string().uuid(),
      posts: z.array(plannedPostSchema).max(60),
    },
  }, async (input) => toolResult(await gateway.call("save_plan_placement", input)));

  server.registerTool("dopa_list_publish_jobs", {
    title: "List Dopa internal dispatch jobs",
    description: "Read internal outbox records. A queued or dispatched record is never presented as proof of a live platform post.",
  }, async () => toolResult(await gateway.call("list_publish_jobs")));

  server.registerTool("dopa_queue_approved_revision", {
    title: "Queue one approved Dopa revision",
    description: "Use only after manual approval in Lovable and a separate explicit scheduling request. This creates internal idempotent dispatch jobs; it does not itself post to the channel APIs.",
    inputSchema: {
      revision_id: z.string().uuid(),
      confirmation: z.literal(CONFIRMATION),
    },
  }, async (input) => toolResult(await gateway.call("queue_approved_revision", input)));

  server.registerPrompt("dopa_plan_campaign", {
    title: "Plan Dopa content safely",
    description: "Start a channel-aware planning conversation with visual review and manual approval.",
    argsSchema: { campaign_brief: z.string().min(1) },
  }, ({ campaign_brief }) => ({
    messages: [{
      role: "user",
      content: {
        type: "text",
        text: `Plan Dopa content for this brief: ${campaign_brief}\n\nFirst read dopa_channel_requirements and the current content plan. Discuss captions, hashtags, alt text, order and timing per channel. Save drafts only after confirmation. Send me to Lovable for the channel-native visual check and manual approval. Do not queue anything until I separately say: ${CONFIRMATION}.`,
      },
    }],
  }));

  server.registerPrompt("dopa_build_content_strategy", {
    title: "Build a Dopa content strategy from evidence",
    description: "Combine Dopa performance, 30-days signals and the user's own context into campaign and content ideas without creating assets.",
    argsSchema: { strategic_question: z.string().min(1) },
  }, ({ strategic_question }) => ({
    messages: [{
      role: "user",
      content: {
        type: "text",
        text: `Help with this Dopa strategy question: ${strategic_question}\n\nFirst read dopa_get_learning_snapshot for the last 30 days. Combine measured results, 30-days research signals and relevant thoughts or transcripts from the user. Clearly separate evidence from hypotheses. Propose a small set of strategies, campaign concepts and channel-specific content briefs. Do not create images or animations. The user will make the chosen concepts in Claude Design and then upload them to the Dopa Hub.`,
      },
    }],
  }));

  return server;
}

export function createRemoteMcpApp(options: RemoteMcpOptions) {
  validateOptions(options);
  const app = createMcpExpressApp({ host: "0.0.0.0" });

  app.get("/health", (_request: Request, response: Response) => {
    response.status(200).json({ ok: true, service: "dopa-remote-mcp" });
  });

  app.post("/mcp/:token", async (request: Request, response: Response) => {
    const pathToken = Array.isArray(request.params.token) ? "" : (request.params.token ?? "");
    if (!sameSecret(pathToken, options.mcpUrlToken)) {
      response.status(404).end();
      return;
    }

    const server = buildRemoteDopaServer(options);
    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
    try {
      // SDK 1.30's Node wrapper and core Transport differ only in optional
      // callback typing under exactOptionalPropertyTypes.
      await server.connect(transport as Parameters<McpServer["connect"]>[0]);
      await transport.handleRequest(request, response, request.body);
      response.on("close", () => {
        void transport.close();
        void server.close();
      });
    } catch {
      if (!response.headersSent) {
        response.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
      }
    }
  });

  app.all("/mcp/:token", (_request: Request, response: Response) => {
    response.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null });
  });

  return app;
}

export function remoteMcpUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/$/, "")}/mcp/${encodeURIComponent(token)}`;
}

export function listenRemoteMcp(options: RemoteMcpOptions, port = Number(process.env.PORT ?? 3000)) {
  const app = createRemoteMcpApp(options);
  return app.listen(port, "0.0.0.0", () => process.stdout.write(`Dopa remote MCP listening on ${port}\n`));
}

class DopaGateway {
  private readonly url: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: RemoteMcpOptions) {
    validateOptions(options);
    this.url = options.gatewayUrl ?? DEFAULT_GATEWAY;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async call(action: string, data: Record<string, unknown> = {}): Promise<unknown> {
    const response = await this.fetchImpl(this.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-dopa-claude-token": this.options.gatewayToken,
      },
      body: JSON.stringify({ action, ...data }),
      signal: AbortSignal.timeout(20_000),
    });
    const body = await response.json().catch(() => undefined) as { error?: string } | undefined;
    if (!response.ok) throw new Error(body?.error ?? `Dopa gateway request failed (${response.status})`);
    return body;
  }
}

function validateOptions(options: RemoteMcpOptions): void {
  if (options.mcpUrlToken.length < 32) throw new Error("DOPA_MCP_URL_TOKEN must contain at least 32 characters");
  if (options.gatewayToken.length < 32) throw new Error("DOPA_CLAUDE_CONNECTOR_TOKEN must contain at least 32 characters");
  if (options.gatewayUrl) {
    const url = new URL(options.gatewayUrl);
    if (url.protocol !== "https:" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
      throw new Error("DOPA_CLAUDE_GATEWAY_URL must use HTTPS");
    }
  }
}

function sameSecret(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function toolResult(value: unknown) {
  const text = JSON.stringify(value, null, 2);
  return { content: [{ type: "text" as const, text }], structuredContent: { result: value } };
}
