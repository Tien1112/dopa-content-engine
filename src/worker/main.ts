#!/usr/bin/env node
import { runWorker } from "./render-worker.js";

runWorker().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
