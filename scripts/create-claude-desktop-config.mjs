import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const output = path.resolve(process.argv[2] ?? "work/dopa-claude-desktop-mcp.json");
const dataRoot = path.resolve(process.argv[3] ?? "work/content-planner");
const server = path.resolve("dist/src/mcp/stdio.js");
const config = {
  mcpServers: {
    "dopa-content-planner": {
      command: process.execPath,
      args: [server],
      env: { DOPA_CONTENT_PLANNER_ROOT: dataRoot }
    }
  }
};

await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
console.log(JSON.stringify({ output, node: process.execPath, server, data: dataRoot }, null, 2));
