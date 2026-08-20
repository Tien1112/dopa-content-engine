import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Manifest } from "./types.js";

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export async function loadManifest(manifestPath: string): Promise<Manifest> {
  let value: unknown;
  try { value = JSON.parse(await readFile(manifestPath, "utf8")); }
  catch (error) { throw new Error(`Cannot read manifest ${manifestPath}: ${String(error)}`); }
  if (!value || typeof value !== "object") throw new Error("Manifest must be a JSON object");
  const v = value as Record<string, unknown>;
  if (v.schema_version !== 1) throw new Error("manifest.schema_version must equal 1");
  if (!nonEmpty(v.content_id)) throw new Error("manifest.content_id is required");
  if (!nonEmpty(v.brand) || !/^[a-z0-9][a-z0-9-]*$/.test(v.brand)) throw new Error("manifest.brand must be a lowercase slug");
  if (!Number.isInteger(v.version) || (v.version as number) < 1) throw new Error("manifest.version must be a positive integer");
  if (!nonEmpty(v.source)) throw new Error("manifest.source is required");
  const canvas = v.canvas as Record<string, unknown> | undefined;
  if (!canvas || !Number.isInteger(canvas.width) || !Number.isInteger(canvas.height) || (canvas.width as number) < 1 || (canvas.height as number) < 1) throw new Error("manifest.canvas needs positive integer width and height");
  if (!Array.isArray(v.outputs) || v.outputs.length === 0) throw new Error("manifest.outputs must be a non-empty array");
  for (const output of v.outputs) {
    if (!output || typeof output !== "object" || !nonEmpty((output as Record<string, unknown>).preset)) throw new Error("Every output needs a preset");
    const mode = (output as Record<string, unknown>).mode;
    if (mode !== undefined && !["exact", "contain", "cover"].includes(String(mode))) throw new Error(`Unsupported render mode: ${String(mode)}`);
  }
  return value as Manifest;
}

export function resolveInsidePackage(manifestPath: string, relativePath: string): string {
  const root = path.resolve(path.dirname(manifestPath));
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new Error(`Path escapes content package: ${relativePath}`);
  return resolved;
}
