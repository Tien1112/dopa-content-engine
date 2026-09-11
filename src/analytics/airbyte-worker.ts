import { AirbyteClient } from "./airbyte.js";
import { HubDataGateway, type DataProvider } from "./hub-data-gateway.js";
import { BigQueryPerformanceReader } from "./bigquery.js";

export async function runAirbyteWorker(): Promise<void> {
  const client = new AirbyteClient({ client_id_env: "DOPA_AIRBYTE_CLIENT_ID", client_secret_env: "DOPA_AIRBYTE_CLIENT_SECRET", ...(process.env.DOPA_AIRBYTE_API_URL ? { api_base_url: process.env.DOPA_AIRBYTE_API_URL } : {}) });
  const gateway = new HubDataGateway(required("DOPA_DATA_GATEWAY_URL"), required("DOPA_DATA_WORKER_TOKEN"));
  const connections = configuredConnections();
  const reader = BigQueryPerformanceReader.fromEnvironment();
  await gateway.health();
  const once = process.env.AIRBYTE_ONCE === "1";
  const interval = Math.max(60_000, Number(process.env.AIRBYTE_SYNC_INTERVAL_MS ?? 21_600_000));
  do {
    for (const [provider, connectionId] of Object.entries(connections) as Array<[DataProvider, string]>) {
      let runId: string | undefined;
      try {
        const started = await client.triggerSync(connectionId);
        runId = await gateway.start(provider, connectionId, started.jobId);
        const finished = await client.waitForJob(started.jobId);
        if (finished.status !== "succeeded") {
          await gateway.complete(runId, finished.status, `Airbyte job ended as ${finished.status}`);
          continue;
        }
        const rows = reader ? await reader.read(provider) : [];
        const loaded = reader ? await gateway.upsert(provider, connectionId, runId, rows) : 0;
        await gateway.complete(runId, "succeeded", undefined, loaded);
      } catch (error) {
        if (runId) await gateway.complete(runId, "failed", error instanceof Error ? error.message : String(error)).catch(() => undefined);
      }
    }
    if (once) return;
    await new Promise((resolve) => setTimeout(resolve, interval));
  } while (true);
}

function configuredConnections(): Partial<Record<DataProvider, string>> {
  let value: unknown;
  try { value = JSON.parse(required("DOPA_AIRBYTE_CONNECTIONS_JSON")); } catch { throw new Error("DOPA_AIRBYTE_CONNECTIONS_JSON must contain valid JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("DOPA_AIRBYTE_CONNECTIONS_JSON must be an object");
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
  const result: Partial<Record<DataProvider, string>> = {};
  for (const [key, id] of Object.entries(value as Record<string, unknown>)) {
    if (!allowed.includes(key as DataProvider) || typeof id !== "string") throw new Error(`Invalid Airbyte connection mapping for ${key}`);
    result[key as DataProvider] = id;
  }
  if (!Object.keys(result).length) throw new Error("At least one Airbyte connection is required");
  return result;
}

function required(name: string): string { const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value; }
