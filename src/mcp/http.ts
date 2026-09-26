import { listenRemoteMcp } from "./remote.js";

const principalsJson = process.env.DOPA_MCP_PRINCIPALS_JSON;
const gatewayToken = process.env.DOPA_CLAUDE_CONNECTOR_TOKEN;
const publicDomain = process.env.RAILWAY_PUBLIC_DOMAIN;
if (!principalsJson) throw new Error("DOPA_MCP_PRINCIPALS_JSON is required");
if (!gatewayToken) throw new Error("DOPA_CLAUDE_CONNECTOR_TOKEN is required");
if (!publicDomain) throw new Error("RAILWAY_PUBLIC_DOMAIN is required");

let principals: Array<{ urlToken: string; email: string }>;
try {
  principals = JSON.parse(principalsJson) as Array<{ urlToken: string; email: string }>;
} catch {
  throw new Error("DOPA_MCP_PRINCIPALS_JSON must be valid JSON");
}
if (!Array.isArray(principals)) throw new Error("DOPA_MCP_PRINCIPALS_JSON must be a JSON array");

listenRemoteMcp({
  principals,
  gatewayToken,
  allowedHosts: [publicDomain, "healthcheck.railway.app", "127.0.0.1", "localhost"],
  ...(process.env.DOPA_CLAUDE_GATEWAY_URL ? { gatewayUrl: process.env.DOPA_CLAUDE_GATEWAY_URL } : {}),
});
