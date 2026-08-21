import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const merge = args.includes("--merge");
const positional = args.filter((arg) => arg !== "--merge");
const output = path.resolve(positional[0] ?? "work/dopa-claude-desktop-mcp.json");
const dataRoot = path.resolve(positional[1] ?? "work/content-planner");
const server = path.resolve("dist/src/mcp/stdio.js");
const dopaConfig = {
  mcpServers: {
    "dopa-content-planner": {
      command: process.execPath,
      args: [server],
      env: { DOPA_CONTENT_PLANNER_ROOT: dataRoot }
    }
  }
};

await mkdir(path.dirname(output), { recursive: true });
let config = dopaConfig;
let backup = null;
if (merge) {
  try {
    const current = JSON.parse(await readFile(output, "utf8"));
    config = {
      ...current,
      mcpServers: {
        ...(current.mcpServers ?? {}),
        ...dopaConfig.mcpServers
      }
    };
    backup = `${output}.before-dopa`;
    await copyFile(output, backup);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}
await writeFile(output, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
console.log(JSON.stringify({ output, backup, merge, node: process.execPath, server, data: dataRoot }, null, 2));
