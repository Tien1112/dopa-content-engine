import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Preset } from "./types.js";

const presetFile = fileURLToPath(new URL("../../../config/output-presets.json", import.meta.url));

export async function loadPresets(): Promise<Record<string, Preset>> {
  return JSON.parse(await readFile(presetFile, "utf8")) as Record<string, Preset>;
}
