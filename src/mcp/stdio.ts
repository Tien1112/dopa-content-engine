import path from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildContentPlannerServer } from "./content-planner-server.js";

const dataRoot = path.resolve(process.env.DOPA_CONTENT_PLANNER_ROOT ?? process.argv[2] ?? "work/content-planner");
const server = buildContentPlannerServer(path.join(dataRoot, "plans"), path.join(dataRoot, "outbox"));
const transport = new StdioServerTransport();
await server.connect(transport);
