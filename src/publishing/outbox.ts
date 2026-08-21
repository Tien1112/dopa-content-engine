import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ContentPlanItem, PublisherAdapter, PublishingChannel } from "./types.js";

const CHANNELS: PublishingChannel[] = ["pinterest", "instagram", "facebook", "google_business_profile", "google_merchant"];

export interface OutboxRecord {
  external_id: string;
  idempotency_key: string;
  status: "awaiting-channel-dispatch" | "dispatched";
  item: ContentPlanItem;
  platform_receipt?: { platform_id: string; recorded_at: string };
  last_error?: { message: string; recorded_at: string };
}

export class OutboxPublisherAdapter implements PublisherAdapter {
  constructor(readonly channel: PublishingChannel, private readonly root: string) {}

  async schedule(item: ContentPlanItem, context: { idempotency_key: string }): Promise<{ external_id: string }> {
    if (item.channel !== this.channel) throw new Error(`Outbox adapter ${this.channel} cannot accept ${item.channel}`);
    const digest = createHash("sha256").update(context.idempotency_key).digest("hex").slice(0, 20);
    const externalId = `outbox-${digest}`;
    const channelRoot = path.join(this.root, this.channel);
    const file = path.join(channelRoot, `${externalId}.json`);
    await mkdir(channelRoot, { recursive: true });
    const record: OutboxRecord = { external_id: externalId, idempotency_key: context.idempotency_key, status: "awaiting-channel-dispatch", item };
    try {
      await writeFile(file, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = JSON.parse(await readFile(file, "utf8")) as { idempotency_key?: string };
      if (existing.idempotency_key !== context.idempotency_key) throw new Error(`Outbox collision for ${externalId}`);
    }
    return { external_id: externalId };
  }
}

export function createOutboxAdapters(root: string): PublisherAdapter[] {
  return CHANNELS.map((channel) => new OutboxPublisherAdapter(channel, root));
}

export async function listOutboxRecords(root: string, channel?: PublishingChannel): Promise<OutboxRecord[]> {
  const channels = channel ? [channel] : CHANNELS;
  const records: OutboxRecord[] = [];
  for (const current of channels) {
    const channelRoot = path.join(root, current);
    let files: string[];
    try { files = (await readdir(channelRoot)).filter((file) => /^outbox-[a-f0-9]{20}\.json$/.test(file)); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    for (const file of files) records.push(JSON.parse(await readFile(path.join(channelRoot, file), "utf8")) as OutboxRecord);
  }
  return records.sort((left, right) => left.external_id.localeCompare(right.external_id));
}

export async function recordDispatchReceipt(root: string, channel: PublishingChannel, externalId: string, platformId: string, recordedAt: string): Promise<OutboxRecord> {
  if (!/^outbox-[a-f0-9]{20}$/.test(externalId)) throw new Error("Invalid outbox external_id");
  if (!platformId.trim()) throw new Error("platform_id is required");
  const file = path.join(root, channel, `${externalId}.json`);
  const record = JSON.parse(await readFile(file, "utf8")) as OutboxRecord;
  if (record.item.channel !== channel || record.external_id !== externalId) throw new Error("Outbox record does not match its channel or ID");
  if (record.status === "dispatched") {
    if (record.platform_receipt?.platform_id !== platformId) throw new Error("A different platform receipt is already recorded");
    return record;
  }
  const { last_error: _lastError, ...withoutError } = record;
  const updated: OutboxRecord = { ...withoutError, status: "dispatched", platform_receipt: { platform_id: platformId, recorded_at: recordedAt } };
  await writeRecord(file, updated);
  return updated;
}

export async function recordDispatchFailure(root: string, channel: PublishingChannel, externalId: string, message: string, recordedAt: string): Promise<OutboxRecord> {
  if (!/^outbox-[a-f0-9]{20}$/.test(externalId)) throw new Error("Invalid outbox external_id");
  const file = path.join(root, channel, `${externalId}.json`);
  const record = JSON.parse(await readFile(file, "utf8")) as OutboxRecord;
  if (record.status === "dispatched") throw new Error(`Cannot record a failure after ${externalId} was dispatched`);
  const updated: OutboxRecord = { ...record, last_error: { message, recorded_at: recordedAt } };
  await writeRecord(file, updated);
  return updated;
}

async function writeRecord(file: string, record: OutboxRecord): Promise<void> {
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, file);
}
