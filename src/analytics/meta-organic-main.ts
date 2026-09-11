import { runMetaOrganicWorker } from "./meta-organic-worker.js";
runMetaOrganicWorker().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
