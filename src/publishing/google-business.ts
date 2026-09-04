import type { ContentPlanItem } from "./types.js";

export interface GoogleBusinessAccountDefinition {
  access_token_env: string;
  account_id: string;
  location_id: string;
  language_code?: string;
}

export interface GoogleBusinessConfig {
  api_base_url?: string;
  accounts: Record<string, GoogleBusinessAccountDefinition>;
}

export interface GoogleBusinessReceipt { platform_id: string; platform_url?: string }

export class GoogleBusinessPublisher {
  constructor(private readonly config: GoogleBusinessConfig, private readonly fetchImpl: typeof fetch = fetch) {}

  async publish(item: ContentPlanItem): Promise<GoogleBusinessReceipt> {
    if (item.channel !== "google_business_profile") throw new Error("Google Business publisher received another channel");
    if (item.content_type !== "update") throw new Error(`Google Business ${item.content_type} needs its complete event/offer contract before publication`);
    if (!item.copy.message.trim()) throw new Error("Google Business summary is required");
    if (item.media.length > 1) throw new Error("Google Business update supports at most one image in this adapter");
    const account = this.config.accounts[item.account_ref];
    if (!account) throw new Error(`No Google Business configuration for account_ref ${item.account_ref}`);
    const token = process.env[account.access_token_env];
    if (!token) throw new Error(`Missing Google access token environment variable ${account.access_token_env}`);
    const parent = `accounts/${safeId(account.account_id)}/locations/${safeId(account.location_id)}`;
    const payload: Record<string, unknown> = {
      languageCode: account.language_code ?? "nl-NL",
      summary: item.copy.message.trim().slice(0, 1500),
      topicType: "STANDARD"
    };
    if (item.media[0]) payload.media = [{ mediaFormat: "PHOTO", sourceUrl: checkedHttps(item.media[0].public_url, "Google Business image") }];
    if (item.copy.destination_url) payload.callToAction = { actionType: cta(item.copy.call_to_action), url: checkedHttps(item.copy.destination_url, "Google Business destination") };

    const response = await this.fetchImpl(`${(this.config.api_base_url ?? "https://mybusiness.googleapis.com").replace(/\/$/, "")}/v4/${parent}/localPosts`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const body = await response.json().catch(() => undefined) as { name?: string; searchUrl?: string; error?: { message?: string } } | undefined;
    if (!response.ok || !body?.name) throw new Error(`Google Business API ${response.status}: ${body?.error?.message ?? "request failed"}`);
    return { platform_id: body.name, ...(body.searchUrl ? { platform_url: body.searchUrl } : {}) };
  }
}

function safeId(value: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid Google Business account or location ID");
  return value;
}

function checkedHttps(value: string | undefined, label: string): string {
  if (!value) throw new Error(`${label} URL is required`);
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error(`${label} URL must be credential-free HTTPS`);
  return url.toString();
}

function cta(value: string | undefined): "BOOK" | "ORDER" | "SHOP" | "LEARN_MORE" | "SIGN_UP" | "CALL" {
  const normalized = value?.trim().toUpperCase().replace(/\s+/g, "_");
  if (normalized && ["BOOK", "ORDER", "SHOP", "LEARN_MORE", "SIGN_UP", "CALL"].includes(normalized)) return normalized as ReturnType<typeof cta>;
  return "LEARN_MORE";
}
