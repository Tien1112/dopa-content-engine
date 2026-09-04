import { runHubChannelWorker } from "./hub-channel-worker.js";
runHubChannelWorker().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
