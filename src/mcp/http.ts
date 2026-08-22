import { listenRemoteMcp } from "./remote.js";

const mcpUrlToken = process.env.DOPA_MCP_URL_TOKEN;
const gatewayToken = process.env.DOPA_CLAUDE_CONNECTOR_TOKEN;
if (!mcpUrlToken) throw new Error("DOPA_MCP_URL_TOKEN is required");
if (!gatewayToken) throw new Error("DOPA_CLAUDE_CONNECTOR_TOKEN is required");

listenRemoteMcp({
  mcpUrlToken,
  gatewayToken,
  ...(process.env.DOPA_CLAUDE_GATEWAY_URL ? { gatewayUrl: process.env.DOPA_CLAUDE_GATEWAY_URL } : {}),
});
