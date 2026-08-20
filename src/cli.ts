#!/usr/bin/env node
import { renderJob } from "./core/render.js";

const manifestPath = process.argv[2];
if (!manifestPath) {
  console.error("Usage: dopa-render <path/to/manifest.json>");
  process.exitCode = 2;
} else {
  try {
    const report = await renderJob(manifestPath);
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== "passed") process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
