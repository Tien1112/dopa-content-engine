#!/usr/bin/env node
import { runHubMetaWorker } from "./hub-meta-worker.js";

runHubMetaWorker().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
