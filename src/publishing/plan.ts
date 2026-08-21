import { createHash } from "node:crypto";
import type {
  ContentPlan,
  ContentPlanItem,
  PlanApprovalRequest,
  PublisherAdapter,
  PublishingChannel,
  PublishingContentType,
  ScheduleReceipt
} from "./types.js";

const ALLOWED_CONTENT_TYPES: Record<PublishingChannel, ReadonlySet<PublishingContentType>> = {
  pinterest: new Set(["pin"]),
  instagram: new Set(["feed_post", "carousel", "story", "reel"]),
  facebook: new Set(["feed_post", "carousel", "story", "reel"]),
  google_business_profile: new Set(["update", "offer", "event"]),
  google_merchant: new Set(["promotion"])
};

function isIsoInstantWithTimezone(value: string): boolean {
  return /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) && Number.isFinite(Date.parse(value));
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isIanaTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function contentPlanHash(plan: ContentPlan): string {
  const approvedContent = {
    schema_version: plan.schema_version,
    plan_id: plan.plan_id,
    revision: plan.revision,
    brand: plan.brand,
    timezone: plan.timezone,
    items: plan.items
  };
  return createHash("sha256").update(canonicalJson(approvedContent)).digest("hex");
}

function itemErrors(item: ContentPlanItem, index: number): string[] {
  const at = `items[${index}]`;
  const errors: string[] = [];
  if (!item.item_id.trim()) errors.push(`${at}.item_id is required`);
  if (!item.account_ref.trim()) errors.push(`${at}.account_ref is required`);
  if (!ALLOWED_CONTENT_TYPES[item.channel]?.has(item.content_type)) {
    errors.push(`${at}.content_type ${item.content_type} is not supported for ${item.channel}`);
  }
  if (!isIsoInstantWithTimezone(item.publish_at)) errors.push(`${at}.publish_at must be an ISO timestamp with a timezone`);
  if (!item.copy.message.trim()) errors.push(`${at}.copy.message is required`);
  if (item.copy.destination_url && !isHttpUrl(item.copy.destination_url)) errors.push(`${at}.copy.destination_url must be HTTP(S)`);
  for (const hashtag of item.copy.hashtags ?? []) {
    if (!hashtag.trim() || /\s/.test(hashtag)) errors.push(`${at}.copy.hashtags contains an invalid hashtag: ${hashtag}`);
  }
  if (item.media.length === 0 && item.channel !== "google_business_profile") errors.push(`${at}.media must contain at least one approved asset`);
  for (const [mediaIndex, asset] of item.media.entries()) {
    const mediaAt = `${at}.media[${mediaIndex}]`;
    if (!asset.asset_id.trim()) errors.push(`${mediaAt}.asset_id is required`);
    if (!asset.file.trim()) errors.push(`${mediaAt}.file is required`);
    if (asset.public_url && !isHttpUrl(asset.public_url)) errors.push(`${mediaAt}.public_url must be HTTP(S)`);
    if (asset.width <= 0 || asset.height <= 0) errors.push(`${mediaAt} has invalid dimensions`);
    if (asset.qa !== "passed") errors.push(`${mediaAt} has not passed render QA`);
  }
  return errors;
}

export function validateContentPlan(plan: ContentPlan): string[] {
  const errors: string[] = [];
  if (plan.schema_version !== 1) errors.push("schema_version must be 1");
  if (!plan.plan_id.trim()) errors.push("plan_id is required");
  if (!Number.isInteger(plan.revision) || plan.revision < 1) errors.push("revision must be a positive integer");
  if (!plan.brand.trim()) errors.push("brand is required");
  if (!isIanaTimezone(plan.timezone)) errors.push(`timezone is not a valid IANA timezone: ${plan.timezone}`);
  if (plan.items.length === 0) errors.push("items must contain at least one item");
  const ids = new Set<string>();
  for (const [index, item] of plan.items.entries()) {
    errors.push(...itemErrors(item, index));
    if (ids.has(item.item_id)) errors.push(`Duplicate item_id: ${item.item_id}`);
    ids.add(item.item_id);
  }
  if (plan.status === "draft" && plan.approval) errors.push("A draft plan cannot contain approval metadata");
  if (plan.status === "approved") {
    if (!plan.approval?.approved_by.trim()) errors.push("An approved plan requires approved_by");
    if (!plan.approval || !isIsoInstantWithTimezone(plan.approval.approved_at)) errors.push("An approved plan requires a valid approved_at timestamp");
    if (!plan.approval?.content_hash || plan.approval.content_hash !== contentPlanHash(plan)) errors.push("Approved plan content no longer matches its approval hash");
  }
  return errors;
}

export function assertValidContentPlan(plan: ContentPlan): void {
  const errors = validateContentPlan(plan);
  if (errors.length) throw new Error(`Invalid content plan:\n- ${errors.join("\n- ")}`);
}

export function approveContentPlan(plan: ContentPlan, approval: PlanApprovalRequest): ContentPlan {
  assertValidContentPlan(plan);
  if (plan.status !== "draft") throw new Error(`Content plan ${plan.plan_id} is already approved`);
  if (!approval.approved_by.trim() || !isIsoInstantWithTimezone(approval.approved_at)) throw new Error("Approval requires an approver and an ISO timestamp with a timezone");
  const approved: ContentPlan = { ...plan, status: "approved", approval: { ...approval, content_hash: contentPlanHash(plan) } };
  assertValidContentPlan(approved);
  return approved;
}

export async function scheduleApprovedPlan(
  plan: ContentPlan,
  adapters: readonly PublisherAdapter[],
  now = new Date()
): Promise<ScheduleReceipt[]> {
  assertValidContentPlan(plan);
  if (plan.status !== "approved") throw new Error(`Content plan ${plan.plan_id} must be approved before scheduling`);
  const adapterMap = new Map(adapters.map((adapter) => [adapter.channel, adapter]));
  return Promise.all(plan.items.map(async (item): Promise<ScheduleReceipt> => {
    const base = { item_id: item.item_id, channel: item.channel };
    if (Date.parse(item.publish_at) <= now.getTime()) return { ...base, status: "failed", error: "publish_at is not in the future" };
    const adapter = adapterMap.get(item.channel);
    if (!adapter) return { ...base, status: "failed", error: `No publisher adapter configured for ${item.channel}` };
    try {
      const result = await adapter.schedule(item, { idempotency_key: `${plan.plan_id}:${item.item_id}` });
      return { ...base, status: "queued", external_id: result.external_id };
    } catch (error) {
      return { ...base, status: "failed", error: error instanceof Error ? error.message : String(error) };
    }
  }));
}
