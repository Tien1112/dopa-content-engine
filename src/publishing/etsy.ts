import type { ContentPlanItem } from "./types.js";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export interface EtsyAccountDefinition {
  api_key_env: string;
  access_token_env: string;
  shop_id: string;
}

export interface EtsyConfig {
  api_base_url?: string;
  accounts: Record<string, EtsyAccountDefinition>;
}

export interface EtsyReceipt { platform_id: string; platform_url?: string; draft_created: true }

interface EtsyPayload {
  price: number;
  quantity: number;
  taxonomy_id: number;
  who_made: "i_did" | "collective" | "someone_else";
  when_made: string;
  is_supply: boolean;
  shipping_profile_id?: number;
  return_policy_id?: number;
  should_auto_renew?: boolean;
  publish: boolean;
}

/** Creates the listing as a draft, uploads its approved image, then activates it only when requested. */
export class EtsyPublisher {
  constructor(private readonly config: EtsyConfig, private readonly fetchImpl: typeof fetch = fetch) {}

  async publish(item: ContentPlanItem): Promise<EtsyReceipt> {
    if (item.channel !== "etsy" || item.content_type !== "listing") throw new Error("Etsy publisher accepts only listing items");
    if (item.media.length < 1 || item.media.some((m) => !["image/png", "image/jpeg"].includes(m.mime_type))) {
      throw new Error("Etsy listing requires at least one approved PNG or JPEG");
    }
    const title = item.copy.title?.trim();
    if (!title) throw new Error("Etsy listing title is required");
    const description = item.copy.message.trim();
    if (!description) throw new Error("Etsy listing description is required");
    const payload = validatePayload(item.provider_payload);
    const account = this.config.accounts[item.account_ref];
    if (!account) throw new Error(`No Etsy configuration for account_ref ${item.account_ref}`);
    const apiKey = process.env[account.api_key_env];
    const token = process.env[account.access_token_env];
    if (!apiKey || !token) throw new Error("Missing Etsy API credentials");
    const base = (this.config.api_base_url ?? "https://openapi.etsy.com/v3/application").replace(/\/$/, "");
    const headers = { authorization: `Bearer ${token}`, "x-api-key": apiKey };

    const draft = await this.formRequest(`${base}/shops/${numericId(account.shop_id)}/listings`, "POST", headers, {
      quantity: String(payload.quantity),
      title: title.slice(0, 140),
      description,
      price: String(payload.price),
      who_made: payload.who_made,
      when_made: payload.when_made,
      taxonomy_id: String(payload.taxonomy_id),
      is_supply: String(payload.is_supply),
      should_auto_renew: String(payload.should_auto_renew ?? true),
      ...(payload.shipping_profile_id ? { shipping_profile_id: String(payload.shipping_profile_id) } : {}),
      ...(payload.return_policy_id ? { return_policy_id: String(payload.return_policy_id) } : {})
    });
    const listingId = numericId(String(draft.listing_id ?? ""));

    for (let index = 0; index < item.media.length; index += 1) {
      const media = item.media[index]!;
      const imageResponse = await this.fetchImpl(checkedHttps(media.public_url, "Etsy image"), { redirect: "error" });
      if (!imageResponse.ok) throw new Error(`Could not download Etsy image (${imageResponse.status})`);
      const declared = Number(imageResponse.headers.get("content-length") ?? 0);
      if (declared > MAX_IMAGE_BYTES) throw new Error("Etsy image exceeds 20 MB");
      const bytes = await imageResponse.arrayBuffer();
      if (!bytes.byteLength || bytes.byteLength > MAX_IMAGE_BYTES) throw new Error("Etsy image is empty or exceeds 20 MB");
      const form = new FormData();
      form.set("rank", String(index + 1));
      form.set("image", new Blob([bytes], { type: media.mime_type }), media.file);
      const uploaded = await this.fetchImpl(`${base}/shops/${numericId(account.shop_id)}/listings/${listingId}/images`, { method: "POST", headers, body: form });
      if (!uploaded.ok) throw new Error(`Etsy image upload failed (${uploaded.status})`);
    }

    if (payload.publish) await this.formRequest(`${base}/shops/${numericId(account.shop_id)}/listings/${listingId}`, "PATCH", headers, { state: "active" });
    return {
      platform_id: listingId,
      draft_created: true,
      ...(draft.url && typeof draft.url === "string" ? { platform_url: draft.url } : {})
    };
  }

  private async formRequest(url: string, method: "POST" | "PATCH", headers: Record<string, string>, fields: Record<string, string>): Promise<Record<string, unknown>> {
    const response = await this.fetchImpl(url, { method, headers: { ...headers, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields) });
    const body = await response.json().catch(() => undefined) as Record<string, unknown> | undefined;
    if (!response.ok || !body) throw new Error(`Etsy API ${response.status}: request failed`);
    return body;
  }
}

function validatePayload(value: Record<string, unknown> | undefined): EtsyPayload {
  const p = value ?? {};
  const result: EtsyPayload = {
    price: Number(p.price), quantity: Number(p.quantity), taxonomy_id: Number(p.taxonomy_id),
    who_made: String(p.who_made) as EtsyPayload["who_made"], when_made: String(p.when_made),
    is_supply: p.is_supply === true,
    publish:
      p.publish === true &&
      p.state === "active" &&
      p.activate_confirmed === true,
  };
  if (!Number.isFinite(result.price) || result.price <= 0) throw new Error("Etsy price must be positive");
  if (!Number.isInteger(result.quantity) || result.quantity < 1) throw new Error("Etsy quantity must be a positive integer");
  if (!Number.isInteger(result.taxonomy_id) || result.taxonomy_id < 1) throw new Error("Etsy taxonomy_id is required");
  if (!["i_did", "collective", "someone_else"].includes(result.who_made)) throw new Error("Etsy who_made is invalid");
  if (!/^[a-z0-9_]{2,40}$/.test(result.when_made)) throw new Error("Etsy when_made is invalid");
  for (const key of ["shipping_profile_id", "return_policy_id"] as const) {
    if (p[key] !== undefined) {
      const n = Number(p[key]);
      if (!Number.isInteger(n) || n < 1) throw new Error(`Etsy ${key} is invalid`);
      result[key] = n;
    }
  }
  if (p.should_auto_renew !== undefined) result.should_auto_renew = p.should_auto_renew === true;
  return result;
}

function numericId(value: string): string {
  if (!/^\d+$/.test(value)) throw new Error("Invalid Etsy shop or listing ID");
  return value;
}

function checkedHttps(value: string | undefined, label: string): string {
  if (!value) throw new Error(`${label} URL is required`);
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error(`${label} URL must be credential-free HTTPS`);
  return url.toString();
}
