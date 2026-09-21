import { listenRemoteMcp } from "./remote.js";

const mcpUrlToken = process.env.DOPA_MCP_URL_TOKEN;
const gatewayToken = process.env.DOPA_CLAUDE_CONNECTOR_TOKEN;
const publicDomain = process.env.RAILWAY_PUBLIC_DOMAIN;
if (!mcpUrlToken) throw new Error("DOPA_MCP_URL_TOKEN is required");
if (!gatewayToken) throw new Error("DOPA_CLAUDE_CONNECTOR_TOKEN is required");
if (!publicDomain) throw new Error("RAILWAY_PUBLIC_DOMAIN is required");

listenRemoteMcp({
  mcpUrlToken,
  gatewayToken,
  allowedHosts: [publicDomain, "127.0.0.1", "localhost"],
  ...(process.env.DOPA_CLAUDE_GATEWAY_URL ? { gatewayUrl: process.env.DOPA_CLAUDE_GATEWAY_URL } : {}),
});
