import { PublishGatewayStore, type HubMetaPublishJob } from "./hub-gateway.js";
import { loadMetaConfigFromEnvironment, MetaGraphPublisher } from "./meta.js";
import type { ContentPlanItem, PublishingContentType } from "./types.js";

export async function processHubMetaJob(
  store: Pick<PublishGatewayStore, "complete" | "fail">,
  publisher: Pick<MetaGraphPublisher, "publish">,
  job: HubMetaPublishJob,
  accountRefs: { instagram: string; facebook: string }
): Promise<void> {
  try {
    const receipt = await publisher.publish(toContentPlanItem(job, accountRefs));
    await store.complete(job.job_id, receipt);
    console.log(`[publish:${job.job_id}] ${job.provider} published as ${receipt.platform_id}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[publish:${job.job_id}] failed: ${message}`);
    try {
      await store.fail(job.job_id, message);
    } catch (reportError) {
      console.error(`[publish:${job.job_id}] failure reporting failed: ${reportError instanceof Error ? reportError.message : String(reportError)}`);
    }
  }
}

export function toContentPlanItem(
  job: HubMetaPublishJob,
  accountRefs: { instagram: string; facebook: string }
): ContentPlanItem {
  const contentType = contentTypeFor(job.placement_key);
  return {
    item_id: job.planned_post_id,
    channel: job.provider,
    content_type: contentType,
    account_ref: accountRefs[job.provider],
    publish_at: job.publish_at,
    media: [{
      asset_id: job.asset.asset_id,
      file: job.asset.file_name,
      public_url: job.asset.download_url,
      mime_type: job.asset.mime_type,
      width: job.asset.width,
      height: job.asset.height,
      qa: job.asset.qa_status
    }],
    copy: {
      message: job.copy_text,
      hashtags: job.hashtags,
      ...(job.alt_text ? { alt_text: job.alt_text } : {}),
      ...(job.destination_url ? { destination_url: withTracking(job.destination_url, job.tracking_code) } : {})
    }
  };
}

function contentTypeFor(placement: HubMetaPublishJob["placement_key"]): PublishingContentType {
  if (placement === "instagram_reel") return "reel";
  if (
    placement === "instagram_feed" ||
    placement === "instagram_square" ||
    placement === "facebook_feed" ||
    placement === "facebook_landscape"
  ) return "feed_post";
  const neverPlacement: never = placement;
  throw new Error(`Unsupported Meta placement ${String(neverPlacement)}`);
}

function withTracking(value: string, trackingCode: string | null): string {
  const url = new URL(value);
  if (trackingCode && !url.searchParams.has("dopa_content")) url.searchParams.set("dopa_content", trackingCode);
  return url.toString();
}

export async function runHubMetaWorker(): Promise<void> {
  const gateway = new PublishGatewayStore(requiredEnv("DOPA_PUBLISH_GATEWAY_URL"), requiredEnv("DOPA_PUBLISH_WORKER_TOKEN"));
  const publisher = new MetaGraphPublisher(await loadMetaConfigFromEnvironment());
  const accountRefs = {
    instagram: process.env.DOPA_META_INSTAGRAM_ACCOUNT_REF ?? "dopa-instagram",
    facebook: process.env.DOPA_META_FACEBOOK_ACCOUNT_REF ?? "dopa-facebook"
  };
  await gateway.health();
  const once = process.env.PUBLISH_ONCE === "1";
  const interval = Math.max(1000, Number(process.env.PUBLISH_POLL_INTERVAL_MS ?? 5000));
  do {
    const job = await gateway.claimMeta();
    if (job) await processHubMetaJob(gateway, publisher, job, accountRefs);
    if (once) return;
    await new Promise((resolve) => setTimeout(resolve, job ? 100 : interval));
  } while (true);
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
