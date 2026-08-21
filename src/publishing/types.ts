export type PublishingChannel =
  | "pinterest"
  | "instagram"
  | "facebook"
  | "google_business_profile"
  | "google_merchant";

export type PublishingContentType =
  | "pin"
  | "feed_post"
  | "carousel"
  | "story"
  | "reel"
  | "update"
  | "offer"
  | "event"
  | "promotion";

export interface ApprovedMediaAsset {
  asset_id: string;
  file: string;
  public_url?: string;
  mime_type: "image/png" | "image/jpeg" | "video/mp4" | "video/webm";
  width: number;
  height: number;
  qa: "passed" | "failed";
}

export interface ChannelCopy {
  message: string;
  title?: string;
  hashtags?: string[];
  first_comment?: string;
  alt_text?: string;
  destination_url?: string;
  call_to_action?: string;
}

export interface ContentPlanItem {
  item_id: string;
  channel: PublishingChannel;
  content_type: PublishingContentType;
  account_ref: string;
  publish_at: string;
  media: ApprovedMediaAsset[];
  copy: ChannelCopy;
}

export interface PlanApproval {
  approved_by: string;
  approved_at: string;
  content_hash: string;
}

export type PlanApprovalRequest = Omit<PlanApproval, "content_hash">;

export interface ContentPlan {
  schema_version: 1;
  plan_id: string;
  revision: number;
  brand: string;
  timezone: string;
  status: "draft" | "approved";
  items: ContentPlanItem[];
  approval?: PlanApproval;
}

export interface ScheduleReceipt {
  item_id: string;
  channel: PublishingChannel;
  status: "queued" | "failed";
  external_id?: string;
  error?: string;
}

export interface PublisherAdapter {
  readonly channel: PublishingChannel;
  schedule(item: ContentPlanItem, context: { idempotency_key: string }): Promise<{ external_id: string }>;
}
