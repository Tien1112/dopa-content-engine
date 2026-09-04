import { runAirbyteWorker } from "./airbyte-worker.js";
runAirbyteWorker().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
