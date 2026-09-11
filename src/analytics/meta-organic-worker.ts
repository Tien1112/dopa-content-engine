import { HubDataGateway } from "./hub-data-gateway.js";
import { MetaOrganicCollector } from "./meta-organic.js";
import { loadMetaConfigFromEnvironment } from "../publishing/meta.js";

export async function runMetaOrganicWorker(): Promise<void> {
  const collector = new MetaOrganicCollector(await loadMetaConfigFromEnvironment());
  const gateway = new HubDataGateway(required("DOPA_DATA_GATEWAY_URL"), required("DOPA_DATA_WORKER_TOKEN"));
  await gateway.health();
  const refs = {
    facebook: process.env.DOPA_META_FACEBOOK_ACCOUNT_REF ?? "dopa-facebook",
    instagram: process.env.DOPA_META_INSTAGRAM_ACCOUNT_REF ?? "dopa-instagram",
  } as const;
  const once = process.env.META_ORGANIC_ONCE === "1";
  const interval = Math.max(3_600_000, Number(process.env.META_ORGANIC_SYNC_INTERVAL_MS ?? 86_400_000));
  do {
    for (const provider of ["facebook", "instagram"] as const) {
      let runId: string | undefined;
      try {
        runId = await gateway.startMetaOrganic(provider);
        const records = await collector.collect(provider, refs[provider], Number(process.env.META_ORGANIC_WINDOW_DAYS ?? 30));
        let loaded = 0;
        for (let offset = 0; offset < records.length; offset += 500) {
          loaded += (await gateway.upsertMetaOrganic(provider, runId, records.slice(offset, offset + 500))).received;
        }
        await gateway.complete(runId, "succeeded");
        console.log(`${provider}: ${loaded} organic post snapshots loaded`);
      } catch (error) {
        if (runId) await gateway.complete(runId, "failed", error instanceof Error ? error.message : String(error)).catch(() => undefined);
        console.error(`${provider}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (once) return;
    await new Promise((resolve) => setTimeout(resolve, interval));
  } while (true);
}

function required(name: string): string { const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value; }
