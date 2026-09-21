import { execFileSync } from "node:child_process";

const serviceRequirements = {
  "dopa-content-engine": ["DOPA_RENDER_GATEWAY_URL", "DOPA_RENDER_WORKER_TOKEN"],
  "dopa-meta-publisher": ["DOPA_PUBLISH_GATEWAY_URL", "DOPA_PUBLISH_WORKER_TOKEN", "DOPA_META_CONFIG_JSON", "DOPA_META_ACCESS_TOKEN"],
  "dopa-channel-publisher": ["DOPA_PUBLISH_GATEWAY_URL", "DOPA_PUBLISH_WORKER_TOKEN", "DOPA_CHANNEL_PROVIDERS", "DOPA_PINTEREST_CONFIG_JSON", "DOPA_ETSY_CONFIG_JSON", "DOPA_ETSY_API_KEY", "DOPA_ETSY_CLIENT_ID", "DOPA_ETSY_REFRESH_TOKEN"],
  "dopa-airbyte-bridge": ["DOPA_DATA_GATEWAY_URL", "DOPA_DATA_WORKER_TOKEN", "DOPA_AIRBYTE_CLIENT_ID", "DOPA_AIRBYTE_CLIENT_SECRET", "DOPA_AIRBYTE_CONNECTIONS_JSON", "DOPA_BIGQUERY_SERVICE_ACCOUNT_JSON"],
  "dopa-claude-mcp": ["DOPA_CLAUDE_GATEWAY_URL", "DOPA_CLAUDE_CONNECTOR_TOKEN", "DOPA_MCP_URL_TOKEN", "RAILWAY_PUBLIC_DOMAIN"],
};

const serviceStatus = parseServiceStatus(runRailway(["service", "status", "--all"]));
const variables = Object.fromEntries(
  Object.keys(serviceRequirements).map((service) => [service, railwayVariables(service)]),
);

const variableChecks = Object.fromEntries(
  Object.entries(serviceRequirements).map(([service, names]) => {
    const missing = names.filter((name) => !hasValue(variables[service]?.[name]));
    return [service, { ok: missing.length === 0, missing }];
  }),
);

const publishVars = variables["dopa-meta-publisher"];
const gateways = {
  render: await gatewayHealth(
    variables["dopa-content-engine"].DOPA_RENDER_GATEWAY_URL,
    "x-dopa-worker-token",
    variables["dopa-content-engine"].DOPA_RENDER_WORKER_TOKEN,
  ),
  publish: await gatewayHealth(
    publishVars.DOPA_PUBLISH_GATEWAY_URL,
    "x-dopa-publish-worker-token",
    publishVars.DOPA_PUBLISH_WORKER_TOKEN,
  ),
  data: await gatewayHealth(
    variables["dopa-airbyte-bridge"].DOPA_DATA_GATEWAY_URL,
    "x-dopa-data-worker-token",
    variables["dopa-airbyte-bridge"].DOPA_DATA_WORKER_TOKEN,
  ),
  claude: await gatewayHealth(
    variables["dopa-claude-mcp"].DOPA_CLAUDE_GATEWAY_URL,
    "x-dopa-claude-token",
    variables["dopa-claude-mcp"].DOPA_CLAUDE_CONNECTOR_TOKEN,
  ),
  mcp: await publicHealth(variables["dopa-claude-mcp"].RAILWAY_PUBLIC_DOMAIN),
};

const services = Object.fromEntries(
  Object.keys(serviceRequirements).map((name) => [name, serviceStatus[name] ?? "MISSING"]),
);
const ok = Object.values(services).every((status) => status === "SUCCESS")
  && Object.values(variableChecks).every((check) => check.ok)
  && Object.values(gateways).every((check) => check.ok);

console.log(JSON.stringify({ ok, services, variables: variableChecks, gateways }, null, 2));
if (!ok) process.exitCode = 1;

function runRailway(args) {
  return execFileSync("railway", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function railwayVariables(service) {
  const value = JSON.parse(runRailway(["variables", "--service", service, "--json"]));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`No variables returned for ${service}`);
  return value;
}

function parseServiceStatus(output) {
  const result = {};
  for (const line of output.split("\n")) {
    const match = line.match(/^([a-z0-9-]+)\s+\|\s+[0-9a-f-]+\s+\|\s+([A-Z_]+)\s*$/i);
    if (match) result[match[1]] = match[2];
  }
  return result;
}

function hasValue(value) {
  return typeof value === "string" && value.trim().length > 0;
}

async function gatewayHealth(endpoint, header, token) {
  if (!hasValue(endpoint) || !hasValue(token)) return { ok: false, status: "missing_config" };
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", [header]: token },
      body: JSON.stringify({ action: "health" }),
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.json().catch(() => ({}));
    return { ok: response.ok && body?.ok === true && body?.version === 1, status: response.status, version: body?.version ?? null };
  } catch (error) {
    return { ok: false, status: error instanceof Error ? error.name : "request_failed" };
  }
}

async function publicHealth(domain) {
  if (!hasValue(domain)) return { ok: false, status: "missing_config" };
  const url = domain.startsWith("http://") || domain.startsWith("https://") ? `${domain.replace(/\/$/, "")}/health` : `https://${domain}/health`;
  try {
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(15_000) });
    const body = await response.json().catch(() => ({}));
    return { ok: response.ok && body?.ok === true, status: response.status };
  } catch (error) {
    return { ok: false, status: error instanceof Error ? error.name : "request_failed" };
  }
}
