import path from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildContentPlannerServer } from "./content-planner-server.js";

const dataRoot = path.resolve(process.env.DOPA_CONTENT_PLANNER_ROOT ?? process.argv[2] ?? "work/content-planner");
const server = buildContentPlannerServer(path.join(dataRoot, "plans"), path.join(dataRoot, "outbox"), {
  previewRoot: path.join(dataRoot, "previews"),
  mediaRoot: path.resolve(process.env.DOPA_MEDIA_ROOT ?? process.cwd())
});
const transport = new StdioServerTransport();
await server.connect(transport);
