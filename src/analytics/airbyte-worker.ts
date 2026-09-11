import { AirbyteClient } from "./airbyte.js";
import { HubDataGateway, type DataProvider } from "./hub-data-gateway.js";
import { BigQueryPerformanceReader, type PerformanceScope } from "./bigquery.js";

export type AirbyteImport = { provider: DataProvider; scope: PerformanceScope };
export type AirbyteConnectionRoute = { name: string; connectionId: string; imports: AirbyteImport[] };

export async function runAirbyteWorker(): Promise<void> {
  const client = new AirbyteClient({ client_id_env: "DOPA_AIRBYTE_CLIENT_ID", client_secret_env: "DOPA_AIRBYTE_CLIENT_SECRET", ...(process.env.DOPA_AIRBYTE_API_URL ? { api_base_url: process.env.DOPA_AIRBYTE_API_URL } : {}) });
  const gateway = new HubDataGateway(required("DOPA_DATA_GATEWAY_URL"), required("DOPA_DATA_WORKER_TOKEN"));
  const connections = configuredConnections();
  const reader = BigQueryPerformanceReader.fromEnvironment();
  await gateway.health();
  const once = process.env.AIRBYTE_ONCE === "1";
  const interval = Math.max(60_000, Number(process.env.AIRBYTE_SYNC_INTERVAL_MS ?? 21_600_000));
  do {
    for (const route of connections) {
      const runs: Array<{ importConfig: AirbyteImport; runId: string }> = [];
      try {
        const started = await client.triggerSync(route.connectionId);
        for (const importConfig of route.imports) {
          runs.push({ importConfig, runId: await gateway.start(importConfig.provider, route.connectionId, started.jobId) });
        }
        const finished = await client.waitForJob(started.jobId);
        if (finished.status !== "succeeded") {
          await Promise.all(runs.map(({ runId }) => gateway.complete(runId, finished.status, `Airbyte job ended as ${finished.status}`)));
          continue;
        }
        for (const { importConfig, runId } of runs) {
          const rows = reader ? await reader.read(importConfig.provider, 35, importConfig.scope) : [];
          const loaded = reader ? await gateway.upsert(importConfig.provider, route.connectionId, runId, rows) : 0;
          await gateway.complete(runId, "succeeded", undefined, loaded);
        }
      } catch (error) {
        await Promise.all(runs.map(({ runId }) => gateway.complete(runId, "failed", error instanceof Error ? error.message : String(error)).catch(() => undefined)));
      }
    }
    if (once) return;
    await new Promise((resolve) => setTimeout(resolve, interval));
  } while (true);
}

export function configuredConnections(raw = required("DOPA_AIRBYTE_CONNECTIONS_JSON")): AirbyteConnectionRoute[] {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("DOPA_AIRBYTE_CONNECTIONS_JSON must contain valid JSON"); }
  const allowed: DataProvider[] = [
    "facebook",
    "instagram",
    "pinterest",
    "etsy",
    "shopify",
    "google_analytics",
    "google_search_console",
    "google_ads",
    "google_business_profile",
    "google_merchant_center",
  ];
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const legacy: AirbyteConnectionRoute[] = [];
    for (const [key, id] of Object.entries(value as Record<string, unknown>)) {
      if (!allowed.includes(key as DataProvider) || typeof id !== "string") throw new Error(`Invalid Airbyte connection mapping for ${key}`);
      legacy.push({ name: key, connectionId: connectionId(id), imports: [{ provider: key as DataProvider, scope: "all" }] });
    }
    if (!legacy.length) throw new Error("At least one Airbyte connection is required");
    return legacy;
  }
  if (!Array.isArray(value) || !value.length) throw new Error("DOPA_AIRBYTE_CONNECTIONS_JSON must be a non-empty array or legacy object");
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`Invalid Airbyte route at index ${index}`);
    const candidate = entry as Record<string, unknown>;
    if (typeof candidate.name !== "string" || !candidate.name.trim()) throw new Error(`Airbyte route ${index} needs a name`);
    if (!Array.isArray(candidate.imports) || !candidate.imports.length) throw new Error(`Airbyte route ${candidate.name} needs imports`);
    const imports = candidate.imports.map((item, importIndex): AirbyteImport => {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`Invalid import ${importIndex} for ${candidate.name}`);
      const itemValue = item as Record<string, unknown>;
      if (!allowed.includes(itemValue.provider as DataProvider)) throw new Error(`Invalid provider for ${candidate.name}`);
      const scope = itemValue.scope ?? "all";
      if (!["all", "paid", "organic"].includes(String(scope))) throw new Error(`Invalid scope for ${candidate.name}`);
      return { provider: itemValue.provider as DataProvider, scope: scope as PerformanceScope };
    });
    return { name: candidate.name.trim(), connectionId: connectionId(candidate.connection_id), imports };
  });
}

function connectionId(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error("Invalid Airbyte connection ID");
  }
  return value;
}

function required(name: string): string { const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value; }
