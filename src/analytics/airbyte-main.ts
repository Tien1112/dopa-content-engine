import { runAirbyteWorker } from "./airbyte-worker.js";
import { listenAirbyteControl } from "./airbyte-control.js";
listenAirbyteControl();
runAirbyteWorker().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
