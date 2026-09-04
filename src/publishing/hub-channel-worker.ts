import { EtsyPublisher, type EtsyConfig } from "./etsy.js";
import { GoogleBusinessPublisher, type GoogleBusinessConfig } from "./google-business.js";
import { ChannelGatewayStore, channelJobToPlanItem, type HubChannelProvider } from "./hub-channel-gateway.js";
import { PinterestPublisher, type PinterestConfig } from "./pinterest.js";

type Publisher = { publish(item: ReturnType<typeof channelJobToPlanItem>): Promise<{ platform_id: string; platform_url?: string }> };

export async function runHubChannelWorker(): Promise<void> {
  const gateway = new ChannelGatewayStore(required("DOPA_PUBLISH_GATEWAY_URL"), required("DOPA_PUBLISH_WORKER_TOKEN"));
  const providers = enabledProviders();
  const publishers = new Map<HubChannelProvider, Publisher>();
  if (providers.includes("pinterest")) publishers.set("pinterest", new PinterestPublisher(jsonConfig<PinterestConfig>("DOPA_PINTEREST_CONFIG_JSON")));
  if (providers.includes("etsy")) publishers.set("etsy", new EtsyPublisher(jsonConfig<EtsyConfig>("DOPA_ETSY_CONFIG_JSON")));
  if (providers.includes("google_business_profile")) publishers.set("google_business_profile", new GoogleBusinessPublisher(jsonConfig<GoogleBusinessConfig>("DOPA_GOOGLE_BUSINESS_CONFIG_JSON")));
  await gateway.health();
  const once = process.env.PUBLISH_ONCE === "1";
  const interval = Math.max(1000, Number(process.env.PUBLISH_POLL_INTERVAL_MS ?? 5000));
  do {
    const job = await gateway.claim(providers);
    if (job) {
      try { const publisher = publishers.get(job.provider); if (!publisher) throw new Error(`No publisher configured for ${job.provider}`); await gateway.complete(job.job_id, await publisher.publish(channelJobToPlanItem(job))); }
      catch (error) { await gateway.fail(job.job_id, error instanceof Error ? error.message : String(error)); }
    }
    if (once) return;
    await new Promise((resolve) => setTimeout(resolve, job ? 100 : interval));
  } while (true);
}

function enabledProviders(): HubChannelProvider[] { const values = required("DOPA_CHANNEL_PROVIDERS").split(",").map((v) => v.trim()).filter(Boolean); const allowed: HubChannelProvider[] = ["pinterest", "etsy", "google_business_profile"]; if (!values.length || values.some((v) => !allowed.includes(v as HubChannelProvider))) throw new Error("DOPA_CHANNEL_PROVIDERS contains an unsupported provider"); return [...new Set(values)] as HubChannelProvider[]; }
function jsonConfig<T>(name: string): T { try { return JSON.parse(required(name)) as T; } catch { throw new Error(`${name} must contain valid JSON`); } }
function required(name: string): string { const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value; }
