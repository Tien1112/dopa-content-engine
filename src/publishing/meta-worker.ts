import path from "node:path";
import { dispatchDueMetaJobs } from "./meta-dispatch.js";
import { loadMetaConfig, MetaGraphPublisher } from "./meta.js";

const plannerRoot = path.resolve(process.env.DOPA_CONTENT_PLANNER_ROOT ?? "work/content-planner");
const configFile = process.env.DOPA_META_CONFIG;
if (!configFile) throw new Error("DOPA_META_CONFIG must point to a private Meta adapter JSON file");
const publisher = new MetaGraphPublisher(await loadMetaConfig(path.resolve(configFile)));
const results = await dispatchDueMetaJobs(path.join(plannerRoot, "outbox"), publisher);
process.stdout.write(`${JSON.stringify({ checked_at: new Date().toISOString(), results }, null, 2)}\n`);
