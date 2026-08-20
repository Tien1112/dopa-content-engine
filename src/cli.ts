#!/usr/bin/env node
import { renderJob } from "./core/render.js";
import { prepareClaudeDesignZip } from "./adapters/claude-design-zip.js";

const [commandOrManifest, ...args] = process.argv.slice(2);
if (!commandOrManifest) {
  console.error("Usage: dopa-render <path/to/manifest.json> | dopa-render prepare-claude-zip <zip> <output-directory>");
  process.exitCode = 2;
} else {
  try {
    if (commandOrManifest === "prepare-claude-zip") {
      if (!args[0] || !args[1]) throw new Error("Usage: dopa-render prepare-claude-zip <zip> <output-directory>");
      console.log(JSON.stringify(await prepareClaudeDesignZip(args[0], args[1], args[2]), null, 2));
    } else {
      const report = await renderJob(commandOrManifest);
      console.log(JSON.stringify(report, null, 2));
      if (report.status !== "passed") process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
