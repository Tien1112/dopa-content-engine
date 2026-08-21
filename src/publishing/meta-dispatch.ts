import { listOutboxRecords, recordDispatchFailure, recordDispatchReceipt } from "./outbox.js";
import type { MetaGraphPublisher } from "./meta.js";

export interface MetaDispatchResult {
  outbox_external_id: string;
  channel: "instagram" | "facebook";
  status: "dispatched" | "failed";
  platform_id?: string;
  error?: string;
}

export async function dispatchDueMetaJobs(outboxRoot: string, publisher: MetaGraphPublisher, now = new Date()): Promise<MetaDispatchResult[]> {
  const records = [
    ...await listOutboxRecords(outboxRoot, "instagram"),
    ...await listOutboxRecords(outboxRoot, "facebook")
  ].filter((record) => record.status === "awaiting-channel-dispatch" && Date.parse(record.item.publish_at) <= now.getTime());
  const results: MetaDispatchResult[] = [];
  for (const record of records) {
    const channel = record.item.channel as "instagram" | "facebook";
    try {
      const receipt = await publisher.publish(record.item);
      await recordDispatchReceipt(outboxRoot, channel, record.external_id, receipt.platform_id, now.toISOString());
      results.push({ outbox_external_id: record.external_id, channel, status: "dispatched", platform_id: receipt.platform_id });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await recordDispatchFailure(outboxRoot, channel, record.external_id, message, now.toISOString());
      results.push({ outbox_external_id: record.external_id, channel, status: "failed", error: message });
    }
  }
  return results;
}
