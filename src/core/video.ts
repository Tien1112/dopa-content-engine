import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { promisify } from "node:util";
import type { OutputQa } from "./types.js";

const execFileAsync = promisify(execFile);

export async function createStaticMp4(inputPng: string, outputMp4: string, durationSeconds: number, frameRate: number): Promise<void> {
  await execFileAsync("ffmpeg", [
    "-y", "-loop", "1", "-i", inputPng,
    "-t", String(durationSeconds), "-r", String(frameRate),
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
    outputMp4
  ], { maxBuffer: 10 * 1024 * 1024 });
}

export async function verifyMp4(input: {
  preset: string;
  pageLabel?: string;
  file: string;
  reportFile: string;
  expectedWidth: number;
  expectedHeight: number;
  fontsLoaded: boolean;
  assetsLoaded: boolean;
}): Promise<OutputQa> {
  const errors: string[] = [];
  let width: number | undefined;
  let height: number | undefined;
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=width,height,codec_name", "-of", "json", input.file
    ]);
    const stream = JSON.parse(stdout).streams?.[0] as { width?: number; height?: number; codec_name?: string } | undefined;
    width = stream?.width;
    height = stream?.height;
    if (!stream) errors.push("MP4 has no video stream");
    if (stream && stream.codec_name !== "h264") errors.push(`Expected H.264 video, got ${stream.codec_name ?? "unknown"}`);
    if (width !== input.expectedWidth || height !== input.expectedHeight) errors.push(`Expected ${input.expectedWidth}x${input.expectedHeight}, got ${width ?? "?"}x${height ?? "?"}`);
  } catch (error) {
    errors.push(`Cannot inspect MP4: ${String(error)}`);
  }
  const bytes = (await stat(input.file)).size;
  if (bytes < 1) errors.push("MP4 is empty");
  return {
    preset: input.preset,
    ...(input.pageLabel ? { page_label: input.pageLabel } : {}),
    file: input.reportFile,
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
    format: "mp4",
    bytes,
    fonts_loaded: input.fontsLoaded,
    assets_loaded: input.assetsLoaded,
    qa: errors.length ? "failed" : "passed",
    errors
  };
}
