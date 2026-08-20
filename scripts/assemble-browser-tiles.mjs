import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const jobsFile = path.resolve(process.argv[2] ?? "work/dopa-approval/render-pages/render-jobs.json");
const tilesRoot = path.resolve(process.argv[3] ?? "work/dopa-approval/tiles");
const outputRoot = path.resolve(process.argv[4] ?? "work/dopa-approval/production/social");
const sharpModule = process.env.DOPA_SHARP_MODULE;
if (!sharpModule) throw new Error("DOPA_SHARP_MODULE must point to sharp/dist/index.mjs");
const sharp = (await import(pathToFileURL(sharpModule).href)).default;
const config = JSON.parse(await readFile(jobsFile, "utf8"));
const viewport = { width: 1280, height: 720 };
const report = [];

for (const job of config.jobs) {
  const xPositions = tilePositions(job.logicalWidth, viewport.width);
  const yPositions = tilePositions(job.logicalHeight, viewport.height);
  const layers = [];
  for (const y of yPositions) {
    for (const x of xPositions) {
      const tile = await readFile(path.join(tilesRoot, job.profile, `${job.label}-${x}-${y}.jpg`));
      const width = Math.min(viewport.width, job.logicalWidth - x);
      const height = Math.min(viewport.height, job.logicalHeight - y);
      const input = await sharp(tile).extract({ left: 0, top: 0, width, height }).toBuffer();
      layers.push({ input, left: x, top: y });
    }
  }
  const profileRoot = path.join(outputRoot, job.profile);
  await mkdir(profileRoot, { recursive: true });
  const output = path.join(profileRoot, `${job.label}.png`);
  const composed = await sharp({ create: { width: job.logicalWidth, height: job.logicalHeight, channels: 4, background: "#FAF4E8" } }).composite(layers).png().toBuffer();
  let image = sharp(composed);
  if (job.width !== job.logicalWidth || job.height !== job.logicalHeight) image = image.resize(job.width, job.height, { fit: "fill", kernel: "lanczos3" });
  await image.png({ compressionLevel: 9 }).toFile(output);
  const metadata = await sharp(output).metadata();
  const passed = metadata.width === job.width && metadata.height === job.height;
  report.push({ profile: job.profile, label: job.label, file: path.relative(outputRoot, output), width: metadata.width, height: metadata.height, qa: passed ? "passed" : "failed" });
}
const status = report.every((item) => item.qa === "passed") ? "passed" : "failed";
await writeFile(path.join(outputRoot, "qa-report.json"), `${JSON.stringify({ status, outputs: report }, null, 2)}\n`);
console.log(JSON.stringify({ status, outputs: report.length, root: outputRoot }, null, 2));

function tilePositions(total, viewportSize) {
  if (total <= viewportSize) return [0];
  const positions = [];
  for (let offset = 0; offset < total; offset += viewportSize) positions.push(Math.min(offset, total - viewportSize));
  return [...new Set(positions)];
}
