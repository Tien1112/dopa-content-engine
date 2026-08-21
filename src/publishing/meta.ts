import { readFile } from "node:fs/promises";
import type { ContentPlanItem } from "./types.js";

export interface MetaAccountDefinition {
  access_token_env: string;
  instagram_user_id?: string;
  facebook_page_id?: string;
}

export interface MetaConfigFile {
  graph_api_version: string;
  graph_base_url?: string;
  accounts: Record<string, MetaAccountDefinition>;
}

export interface MetaPublishReceipt {
  platform_id: string;
  container_ids?: string[];
}

export class MetaGraphPublisher {
  constructor(
    private readonly config: MetaConfigFile,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly sleep: (milliseconds: number) => Promise<void> = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
  ) {
    if (!/^v\d+\.\d+$/.test(config.graph_api_version)) throw new Error("Meta graph_api_version must look like v25.0");
  }

  async publish(item: ContentPlanItem): Promise<MetaPublishReceipt> {
    const account = this.config.accounts[item.account_ref];
    if (!account) throw new Error(`No Meta account configuration for account_ref ${item.account_ref}`);
    const token = process.env[account.access_token_env];
    if (!token) throw new Error(`Missing Meta access token environment variable ${account.access_token_env}`);
    if (item.channel === "instagram") return this.publishInstagram(item, account, token);
    if (item.channel === "facebook") return this.publishFacebook(item, account, token);
    throw new Error(`Meta publisher cannot accept ${item.channel}`);
  }

  private async publishInstagram(item: ContentPlanItem, account: MetaAccountDefinition, token: string): Promise<MetaPublishReceipt> {
    if (!account.instagram_user_id) throw new Error(`Meta account ${item.account_ref} has no instagram_user_id`);
    const userId = account.instagram_user_id;
    const caption = metaCaption(item);
    if (item.content_type === "feed_post") {
      if (item.media.length !== 1 || !isImage(item.media[0]!.mime_type)) throw new Error("Instagram feed_post currently requires exactly one PNG or JPEG");
      const container = await this.post(`${userId}/media`, { image_url: publicUrl(item.media[0]!), caption }, token);
      return this.publishInstagramContainer(userId, container.id, token, [container.id]);
    }
    if (item.content_type === "carousel") {
      if (item.media.length < 2 || item.media.length > 10 || item.media.some((asset) => !isImage(asset.mime_type))) throw new Error("Instagram carousel currently requires 2-10 PNG/JPEG assets");
      const children: string[] = [];
      for (const asset of item.media) children.push((await this.post(`${userId}/media`, { image_url: publicUrl(asset), is_carousel_item: "true" }, token)).id);
      const container = await this.post(`${userId}/media`, { media_type: "CAROUSEL", children: children.join(","), caption }, token);
      return this.publishInstagramContainer(userId, container.id, token, [...children, container.id]);
    }
    if (item.content_type === "reel") {
      if (item.media.length !== 1 || item.media[0]!.mime_type !== "video/mp4") throw new Error("Instagram reel currently requires exactly one MP4");
      const container = await this.post(`${userId}/media`, { media_type: "REELS", video_url: publicUrl(item.media[0]!), caption, share_to_feed: "true" }, token);
      await this.waitUntilReady(container.id, token);
      return this.publishInstagramContainer(userId, container.id, token, [container.id]);
    }
    throw new Error(`Instagram ${item.content_type} is not yet proven by the Dopa Meta adapter`);
  }

  private async publishInstagramContainer(userId: string, creationId: string, token: string, containerIds: string[]): Promise<MetaPublishReceipt> {
    const published = await this.post(`${userId}/media_publish`, { creation_id: creationId }, token);
    return { platform_id: published.id, container_ids: containerIds };
  }

  private async publishFacebook(item: ContentPlanItem, account: MetaAccountDefinition, token: string): Promise<MetaPublishReceipt> {
    if (!account.facebook_page_id) throw new Error(`Meta account ${item.account_ref} has no facebook_page_id`);
    if (item.content_type !== "feed_post") throw new Error(`Facebook ${item.content_type} is not yet proven by the Dopa Meta adapter`);
    const pageId = account.facebook_page_id;
    if (item.media.length === 0) {
      const published = await this.post(`${pageId}/feed`, { message: metaCaption(item), ...(item.copy.destination_url ? { link: item.copy.destination_url } : {}) }, token);
      return { platform_id: published.id };
    }
    if (item.media.length === 1 && isImage(item.media[0]!.mime_type)) {
      const published = await this.post(`${pageId}/photos`, { url: publicUrl(item.media[0]!), message: metaCaption(item), published: "true" }, token);
      return { platform_id: published.post_id ?? published.id };
    }
    throw new Error("Facebook feed_post currently supports text/link or exactly one PNG/JPEG");
  }

  private async waitUntilReady(containerId: string, token: string): Promise<void> {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const status = await this.get(containerId, { fields: "status_code" }, token) as { status_code?: string };
      if (status.status_code === "FINISHED" || status.status_code === "PUBLISHED") return;
      if (status.status_code === "ERROR" || status.status_code === "EXPIRED") throw new Error(`Meta rejected media container ${containerId}: ${status.status_code}`);
      await this.sleep(2000);
    }
    throw new Error(`Meta media container ${containerId} was not ready within 60 seconds`);
  }

  private async post(endpoint: string, fields: Record<string, string>, token: string): Promise<{ id: string; post_id?: string }> {
    const response = await this.fetchImpl(this.url(endpoint), { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ...fields, access_token: token }) });
    return this.parseResponse(response) as Promise<{ id: string; post_id?: string }>;
  }

  private async get(endpoint: string, fields: Record<string, string>, token: string): Promise<unknown> {
    const url = new URL(this.url(endpoint));
    for (const [key, value] of Object.entries({ ...fields, access_token: token })) url.searchParams.set(key, value);
    return this.parseResponse(await this.fetchImpl(url));
  }

  private url(endpoint: string): string {
    const base = (this.config.graph_base_url ?? "https://graph.facebook.com").replace(/\/$/, "");
    return `${base}/${this.config.graph_api_version}/${endpoint.replace(/^\//, "")}`;
  }

  private async parseResponse(response: Response): Promise<unknown> {
    const body = await response.json().catch(() => undefined) as { error?: { message?: string; code?: number } } | undefined;
    if (!response.ok || body?.error) throw new Error(`Meta Graph API ${response.status}: ${body?.error?.message ?? "request failed"}${body?.error?.code ? ` (code ${body.error.code})` : ""}`);
    return body;
  }
}

export async function loadMetaConfig(file: string): Promise<MetaConfigFile> {
  const parsed = JSON.parse(await readFile(file, "utf8")) as MetaConfigFile;
  if (!parsed || typeof parsed !== "object" || !parsed.accounts || !parsed.graph_api_version) throw new Error("Invalid Meta adapter config");
  for (const [accountRef, account] of Object.entries(parsed.accounts)) {
    if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(accountRef)) throw new Error(`Invalid Meta account_ref: ${accountRef}`);
    if (!account.access_token_env || !/^[A-Z][A-Z0-9_]*$/.test(account.access_token_env)) throw new Error(`Invalid access_token_env for ${accountRef}`);
    if (!account.instagram_user_id && !account.facebook_page_id) throw new Error(`Meta account ${accountRef} needs an Instagram user ID or Facebook Page ID`);
  }
  return parsed;
}

function publicUrl(asset: ContentPlanItem["media"][number]): string {
  if (!asset.public_url) throw new Error(`Asset ${asset.asset_id} needs public_url before Meta dispatch`);
  const url = new URL(asset.public_url);
  if (url.protocol !== "https:") throw new Error(`Asset ${asset.asset_id} public_url must use HTTPS`);
  return url.toString();
}

function isImage(mimeType: string): boolean { return mimeType === "image/png" || mimeType === "image/jpeg"; }

function metaCaption(item: ContentPlanItem): string {
  const hashtags = (item.copy.hashtags ?? []).map((value) => `#${value.replace(/^#/, "")}`);
  return [item.copy.message.trim(), hashtags.join(" ")].filter(Boolean).join("\n\n");
}
