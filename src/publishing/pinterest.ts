import type { ContentPlanItem } from "./types.js";

export interface PinterestAccountDefinition {
  access_token_env: string;
  board_id: string;
}

export interface PinterestConfig {
  api_base_url?: string;
  accounts: Record<string, PinterestAccountDefinition>;
}

export interface PinterestReceipt { platform_id: string; platform_url?: string }

export class PinterestPublisher {
  constructor(private readonly config: PinterestConfig, private readonly fetchImpl: typeof fetch = fetch) {}

  async publish(item: ContentPlanItem): Promise<PinterestReceipt> {
    if (item.channel !== "pinterest" || item.content_type !== "pin") throw new Error("Pinterest publisher accepts only Pin items");
    if (item.media.length !== 1 || !["image/png", "image/jpeg"].includes(item.media[0]!.mime_type)) {
      throw new Error("Pinterest image Pin requires exactly one PNG or JPEG");
    }
    const account = this.config.accounts[item.account_ref];
    if (!account) throw new Error(`No Pinterest configuration for account_ref ${item.account_ref}`);
    const requestedBoard = String(item.provider_payload?.board_id ?? "").trim();
    if (!requestedBoard || requestedBoard !== account.board_id) {
      throw new Error("Pinterest board_id does not match the configured account route");
    }
    const token = process.env[account.access_token_env];
    if (!token) throw new Error(`Missing Pinterest token environment variable ${account.access_token_env}`);
    const imageUrl = checkedHttps(item.media[0]!.public_url, "Pinterest image");
    const title = item.copy.title?.trim();
    if (!title) throw new Error("Pinterest Pin title is required");

    const response = await this.fetchImpl(`${(this.config.api_base_url ?? "https://api.pinterest.com").replace(/\/$/, "")}/v5/pins`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        board_id: requestedBoard,
        title: title.slice(0, 100),
        description: item.copy.message.trim().slice(0, 500),
        ...(item.copy.alt_text ? { alt_text: item.copy.alt_text.trim().slice(0, 500) } : {}),
        ...(item.copy.destination_url ? { link: checkedHttps(item.copy.destination_url, "Pinterest destination") } : {}),
        media_source: { source_type: "image_url", url: imageUrl }
      })
    });
    const body = await response.json().catch(() => undefined) as { id?: string; link?: string; message?: string; code?: number } | undefined;
    if (!response.ok || !body?.id) throw new Error(`Pinterest API ${response.status}: ${body?.message ?? "request failed"}`);
    return { platform_id: body.id, ...(body.link ? { platform_url: body.link } : {}) };
  }
}

function checkedHttps(value: string | undefined, label: string): string {
  if (!value) throw new Error(`${label} URL is required`);
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error(`${label} URL must be credential-free HTTPS`);
  return url.toString();
}
