import { stat } from "node:fs/promises";
import { readPngMetadata } from "./png.js";
import type { OutputQa } from "./types.js";

interface VerifyPngInput {
  preset: string;
  pageLabel?: string;
  file: string;
  reportFile: string;
  expectedWidth: number;
  expectedHeight: number;
  requireAlpha: boolean;
  fontsLoaded: boolean;
  assetsLoaded: boolean;
  priorErrors?: string[];
}

export async function verifyPng(input: VerifyPngInput): Promise<OutputQa> {
  const errors = [...(input.priorErrors ?? [])];
  const metadata = await readPngMetadata(input.file);
  const fileStat = await stat(input.file);
  if (metadata.width !== input.expectedWidth || metadata.height !== input.expectedHeight) errors.push(`Expected ${input.expectedWidth}x${input.expectedHeight}, got ${metadata.width}x${metadata.height}`);
  if (fileStat.size <= 0) errors.push("Output file is empty");
  if (input.requireAlpha && !metadata.alpha) errors.push("Output PNG does not contain an alpha channel");
  if (!input.fontsLoaded) errors.push("Required fonts did not load");
  if (!input.assetsLoaded) errors.push("Required assets did not load");
  return {
    preset: input.preset,
    ...(input.pageLabel ? { page_label: input.pageLabel } : {}),
    file: input.reportFile,
    ...metadata,
    bytes: fileStat.size,
    fonts_loaded: input.fontsLoaded,
    assets_loaded: input.assetsLoaded,
    qa: errors.length ? "failed" : "passed",
    errors
  };
}
