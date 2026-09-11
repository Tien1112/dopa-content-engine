import type { ContentPlanItem } from "./types.js";

export interface PinterestAccountDefinition {
  access_token_env?: string;
  client_id_env?: string;
  client_secret_env?: string;
  scopes?: string[];
  board_id: string;
}

export interface PinterestConfig {
  api_base_url?: string;
  accounts: Record<string, PinterestAccountDefinition>;
}

export interface PinterestReceipt { platform_id: string; platform_url?: string }

export class PinterestPublisher {
  private readonly tokens = new Map<string, { value: string; expiresAt: number }>();

  constructor(
    private readonly config: PinterestConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly sleep: (milliseconds: number) => Promise<void> = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  ) {}

  async publish(item: ContentPlanItem): Promise<PinterestReceipt> {
    if (item.channel !== "pinterest" || item.content_type !== "pin") throw new Error("Pinterest publisher accepts only Pin items");
    if (item.media.length !== 1 || !["image/png", "image/jpeg", "video/mp4"].includes(item.media[0]!.mime_type)) throw new Error("Pinterest Pin requires exactly one PNG, JPEG or MP4");
    const account = this.config.accounts[item.account_ref];
    if (!account) throw new Error(`No Pinterest configuration for account_ref ${item.account_ref}`);
    const requestedBoard = String(item.provider_payload?.board_id ?? "").trim();
    if (!requestedBoard || requestedBoard !== account.board_id) {
      throw new Error("Pinterest board_id does not match the configured account route");
    }
    const token = await this.accessToken(item.account_ref, account);
    const media = item.media[0]!;
    const title = item.copy.title?.trim();
    if (!title) throw new Error("Pinterest Pin title is required");

    const mediaSource = media.mime_type === "video/mp4"
      ? await this.uploadVideo(media.public_url, item.provider_payload?.cover_image_url, token)
      : { source_type: "image_url", url: checkedHttps(media.public_url, "Pinterest image") };
    const response = await this.fetchImpl(`${this.base()}/v5/pins`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        board_id: requestedBoard,
        title: title.slice(0, 100),
        description: item.copy.message.trim().slice(0, 500),
        ...(item.copy.alt_text ? { alt_text: item.copy.alt_text.trim().slice(0, 500) } : {}),
        ...(item.copy.destination_url ? { link: checkedHttps(item.copy.destination_url, "Pinterest destination") } : {}),
        media_source: mediaSource
      })
    });
    const body = await response.json().catch(() => undefined) as { id?: string; link?: string; message?: string; code?: number } | undefined;
    if (!response.ok || !body?.id) throw new Error(`Pinterest API ${response.status}: ${body?.message ?? "request failed"}`);
    return { platform_id: body.id, ...(body.link ? { platform_url: body.link } : {}) };
  }

  private async uploadVideo(videoValue: string | undefined, coverValue: unknown, token: string): Promise<Record<string, string>> {
    const videoUrl = checkedHttps(videoValue, "Pinterest video");
    if (typeof coverValue !== "string") throw new Error("Pinterest video Pin requires provider_payload.cover_image_url");
    const coverImageUrl = checkedHttps(coverValue, "Pinterest video cover");
    const registration = await this.json(`${this.base()}/v5/media`, token, { media_type: "video" }) as {
      media_id?: string; upload_url?: string; upload_parameters?: Record<string, string>;
    };
    if (!registration.media_id || !registration.upload_url || !registration.upload_parameters) throw new Error("Pinterest media registration returned incomplete upload details");
    const asset = await this.fetchImpl(videoUrl, { redirect: "error" });
    if (!asset.ok) throw new Error(`Pinterest video download failed (${asset.status})`);
    const bytes = await asset.arrayBuffer();
    if (bytes.byteLength === 0 || bytes.byteLength > 500 * 1024 * 1024) throw new Error("Pinterest video must be between 1 byte and 500 MB");
    const form = new FormData();
    for (const [key, value] of Object.entries(registration.upload_parameters)) form.append(key, value);
    form.append("file", new Blob([bytes], { type: "video/mp4" }), "dopa-pin.mp4");
    const uploaded = await this.fetchImpl(checkedHttps(registration.upload_url, "Pinterest upload"), { method: "POST", body: form, redirect: "error" });
    if (!uploaded.ok) throw new Error(`Pinterest video upload failed (${uploaded.status})`);
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const statusResponse = await this.fetchImpl(`${this.base()}/v5/media/${encodeURIComponent(registration.media_id)}`, { headers: { authorization: `Bearer ${token}` }, redirect: "error" });
      const statusBody = await statusResponse.json().catch(() => undefined) as { status?: string; message?: string } | undefined;
      if (!statusResponse.ok) throw new Error(`Pinterest media status failed (${statusResponse.status})`);
      if (statusBody?.status === "succeeded") return { source_type: "video_id", media_id: registration.media_id, cover_image_url: coverImageUrl };
      if (statusBody?.status === "failed") throw new Error(`Pinterest rejected video: ${statusBody.message ?? "processing failed"}`);
      await this.sleep(2000);
    }
    throw new Error("Pinterest video was not ready within 60 seconds");
  }

  private async json(url: string, token: string, body: unknown): Promise<unknown> {
    const response = await this.fetchImpl(url, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body), redirect: "error" });
    const value = await response.json().catch(() => undefined) as { message?: string } | undefined;
    if (!response.ok) throw new Error(`Pinterest API ${response.status}: ${value?.message ?? "request failed"}`);
    return value;
  }

  private async accessToken(accountRef: string, account: PinterestAccountDefinition): Promise<string> {
    const directName = account.access_token_env;
    if (directName) {
      const direct = process.env[directName];
      if (!direct) throw new Error(`Missing Pinterest token environment variable ${directName}`);
      return direct;
    }

    if (!account.client_id_env || !account.client_secret_env) {
      throw new Error(`Pinterest account ${accountRef} needs access_token_env or client credential environment variables`);
    }
    const cached = this.tokens.get(accountRef);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.value;

    const clientId = process.env[account.client_id_env];
    const clientSecret = process.env[account.client_secret_env];
    if (!clientId || !clientSecret) throw new Error(`Missing Pinterest client credentials for ${accountRef}`);
    const scopes = account.scopes ?? ["boards:read", "pins:write"];
    if (!scopes.includes("pins:write")) throw new Error(`Pinterest account ${accountRef} must request pins:write`);
    const response = await this.fetchImpl(`${this.base()}/v5/oauth/token`, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ grant_type: "client_credentials", scope: scopes.join(",") }),
      redirect: "error",
    });
    const body = await response.json().catch(() => undefined) as { access_token?: string; expires_in?: number; scope?: string; message?: string } | undefined;
    if (!response.ok || !body?.access_token) throw new Error(`Pinterest OAuth ${response.status}: ${body?.message ?? "request failed"}`);
    const granted = new Set(String(body.scope ?? "").split(/[ ,]+/).filter(Boolean));
    if (!granted.has("pins:write")) throw new Error("Pinterest OAuth token does not include pins:write");
    this.tokens.set(accountRef, { value: body.access_token, expiresAt: Date.now() + Math.max(60, body.expires_in ?? 3600) * 1000 });
    return body.access_token;
  }

  private base(): string { return (this.config.api_base_url ?? "https://api.pinterest.com").replace(/\/$/, ""); }
}

function checkedHttps(value: string | undefined, label: string): string {
  if (!value) throw new Error(`${label} URL is required`);
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error(`${label} URL must be credential-free HTTPS`);
  return url.toString();
}
