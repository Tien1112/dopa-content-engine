import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";

const WORKSPACE_ID = "0f306f05-1276-448f-83b4-5974f4f1e456";
const BUILDER_PROJECT_ID = "382cb773-408c-4651-ac02-139c8452cae3";
const DESTINATION_ID = "563166ae-9065-4a72-9e5a-80f49b053eed";
const SOURCE_NAME = "Dopa Etsy";
const CONNECTION_NAME = "Dopa Etsy → Dopa BigQuery";
const DEFAULT_START_TIMESTAMP = 1735689600; // 2025-01-01T00:00:00Z

const publisher = railwayVariables("dopa-channel-publisher");
const bridge = railwayVariables("dopa-airbyte-bridge");
const token = await airbyteToken(
  required(bridge, "DOPA_AIRBYTE_CLIENT_ID"),
  required(bridge, "DOPA_AIRBYTE_CLIENT_SECRET"),
);
const definitionId = await resolveDefinitionId(token);
if (process.argv.includes("--inspect-only")) {
  const definition = await airbyte(
    "GET",
    `/v1/workspaces/${WORKSPACE_ID}/definitions/declarative_sources/${definitionId}`,
    token,
  );
  const manifest = definition.manifest ?? definition.data?.manifest ?? {};
  console.log(JSON.stringify({
    definitionId,
    version: definition.version ?? definition.data?.version ?? null,
    manifestVersion: manifest.version ?? null,
    authenticatorType: manifest.definitions?.authenticator?.type ?? null,
    streams: Array.isArray(manifest.streams) ? manifest.streams.map((stream) => stream?.name).filter(Boolean) : [],
  }));
  process.exit(0);
}
if (process.argv.includes("--publish-manifest")) {
  const manifest = parseYaml(readFileSync(new URL("../config/airbyte/etsy-manifest.yaml", import.meta.url), "utf8"));
  await airbyte(
    "PUT",
    `/v1/workspaces/${WORKSPACE_ID}/definitions/declarative_sources/${definitionId}`,
    token,
    { manifest },
  );
}
await verifyEtsyCredentials(publisher);

const sources = await airbyte("GET", `/v1/sources?workspaceIds=${WORKSPACE_ID}&limit=100`, token);
let source = records(sources).find((row) => row.name === SOURCE_NAME && typeof row.sourceId === "string");

if (!source) {
  source = await airbyte("POST", "/v1/sources", token, {
    name: SOURCE_NAME,
    workspaceId: WORKSPACE_ID,
    definitionId,
    configuration: {
      shop_id: etsyShopId(publisher),
      api_key: required(publisher, "DOPA_ETSY_API_KEY"),
      client_id: required(publisher, "DOPA_ETSY_CLIENT_ID"),
      refresh_token: required(publisher, "DOPA_ETSY_REFRESH_TOKEN"),
      start_timestamp: Number(publisher.DOPA_ETSY_AIRBYTE_START_TIMESTAMP ?? DEFAULT_START_TIMESTAMP),
    },
  });
}

const sourceId = requiredId(source, "sourceId");
const streamResponse = await airbyte(
  "GET",
  `/v1/streams?sourceId=${sourceId}&destinationId=${DESTINATION_ID}&ignoreCache=true`,
  token,
);
const availableStreams = records(streamResponse);
if (availableStreams.length < 2) {
  throw new Error(`Airbyte discovered ${availableStreams.length} Etsy streams; expected receipts and listings`);
}
const connections = await airbyte("GET", `/v1/connections?workspaceIds=${WORKSPACE_ID}&limit=100`, token);
let connection = records(connections).find((row) => row.name === CONNECTION_NAME && typeof row.connectionId === "string");

if (!connection) {
  connection = await airbyte("POST", "/v1/connections", token, {
    name: CONNECTION_NAME,
    sourceId,
    destinationId: DESTINATION_ID,
    schedule: { scheduleType: "cron", cronExpression: "0 0 4 * * ?" },
    dataResidency: "auto",
    namespaceDefinition: "destination",
    nonBreakingSchemaUpdatesBehavior: "propagate_columns",
    status: "active",
  });
}

const connectionId = requiredId(connection, "connectionId");
const job = await airbyte("POST", "/v1/jobs", token, { connectionId, jobType: "sync" });
const jobId = Number(job.jobId ?? job.id);
if (!Number.isSafeInteger(jobId)) throw new Error("Airbyte returned no valid job ID");

console.log(JSON.stringify({ sourceId, connectionId, jobId, status: "sync_started" }));

async function resolveDefinitionId(accessToken) {
  const declarative = await airbyte("GET", `/v1/workspaces/${WORKSPACE_ID}/definitions/declarative_sources`, accessToken);
  const catalog = await airbyte("GET", `/v1/workspaces/${WORKSPACE_ID}/definitions/sources`, accessToken);
  const matches = [...records(declarative), ...records(catalog)].filter((row) =>
    row.name === SOURCE_NAME || row.connectorBuilderProjectId === BUILDER_PROJECT_ID || row.definitionId === BUILDER_PROJECT_ID
  );
  const published = matches.find((row) =>
    typeof row.sourceDefinitionId === "string" || typeof row.definitionId === "string" || typeof row.id === "string"
  );
  if (!published) throw new Error("Published Dopa Etsy source definition was not found for this Airbyte application");
  const key = typeof published.sourceDefinitionId === "string"
    ? "sourceDefinitionId"
    : typeof published.definitionId === "string"
      ? "definitionId"
      : "id";
  return requiredId(published, key);
}

function railwayVariables(service) {
  const output = execFileSync("railway", ["variables", "--service", service, "--json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const value = JSON.parse(output);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`No variables returned for ${service}`);
  return value;
}

async function airbyteToken(clientId, clientSecret) {
  const response = await fetch("https://api.airbyte.com/v1/applications/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, "grant-type": "client_credentials" }),
  });
  const body = await json(response, "Airbyte token");
  return required(body, "access_token");
}

async function airbyte(method, path, accessToken, body) {
  const response = await fetch(`https://api.airbyte.com${path}`, {
    method,
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return json(response, `Airbyte ${method} ${path}`);
}

async function json(response, label) {
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { detail: text };
  }
  if (!response.ok) {
    const detail = String(
      body?.detail ?? body?.message ?? body?.title ?? text ?? "request failed",
    ).slice(0, 1000);
    throw new Error(`${label} failed (${response.status}): ${detail}`);
  }
  return body;
}

function records(value) {
  return Array.isArray(value) ? value : Array.isArray(value?.data) ? value.data : [];
}

function required(values, name) {
  const value = values?.[name];
  if (typeof value !== "string" || !value) throw new Error(`Missing ${name}`);
  return value;
}

function requiredId(value, name) {
  const id = value?.[name];
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error(`Airbyte returned no valid ${name}`);
  return id;
}

function etsyShopId(values) {
  if (typeof values.DOPA_ETSY_SHOP_ID === "string" && /^\d+$/.test(values.DOPA_ETSY_SHOP_ID)) return values.DOPA_ETSY_SHOP_ID;
  if (typeof values.DOPA_ETSY_CONFIG_JSON === "string") {
    const parsed = JSON.parse(values.DOPA_ETSY_CONFIG_JSON);
    for (const account of Object.values(parsed?.accounts ?? {})) {
      if (account && typeof account === "object" && /^\d+$/.test(String(account.shop_id ?? ""))) return String(account.shop_id);
    }
  }
  throw new Error("Missing numeric Etsy shop ID");
}

async function verifyEtsyCredentials(values) {
  const clientId = required(values, "DOPA_ETSY_CLIENT_ID");
  const refreshToken = required(values, "DOPA_ETSY_REFRESH_TOKEN");
  const apiKey = required(values, "DOPA_ETSY_API_KEY");
  const shopId = etsyShopId(values);
  const tokenResponse = await fetch("https://api.etsy.com/v3/public/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", client_id: clientId, refresh_token: refreshToken }),
  });
  const tokenBody = await json(tokenResponse, "Etsy OAuth refresh");
  const accessToken = required(tokenBody, "access_token");
  for (const path of [`shops/${shopId}/receipts?limit=1`, `shops/${shopId}/listings?state=active&limit=1`]) {
    const response = await fetch(`https://openapi.etsy.com/v3/application/${path}`, {
      headers: { authorization: `Bearer ${accessToken}`, "x-api-key": apiKey },
    });
    await json(response, `Etsy GET ${path.split("?")[0]}`);
  }
}
