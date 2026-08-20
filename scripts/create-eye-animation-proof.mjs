import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { Resvg } from "@resvg/resvg-js";

const runFile = promisify(execFile);
const zipPath = path.resolve(process.argv[2] ?? "");
const outputRoot = path.resolve(process.argv[3] ?? "work/dopa-eye-animation-proof");
const workRoot = path.resolve("work");
const fps = 30;
const duration = 3.6;
const frameCount = Math.round(fps * duration);
const ink = "1A1A1A";

if (!zipPath) throw new Error("Usage: node scripts/create-eye-animation-proof.mjs <animation.zip> [output-directory]");
if (!outputRoot.startsWith(`${workRoot}${path.sep}`)) throw new Error("Animation output must stay inside the repository work directory");

const listing = await unzipText(["-Z1", zipPath]);
const entries = listing.split(/\r?\n/).filter(Boolean);
validateEntries(entries);
for (const required of ["Eye Loop 3a.dc.html", "eye-loop.jsx"]) {
  if (!entries.includes(required)) throw new Error(`Approved animation source is missing: ${required}`);
}

const dcSource = await unzipText(["-p", zipPath, "Eye Loop 3a.dc.html"]);
const jsxSource = await unzipText(["-p", zipPath, "eye-loop.jsx"]);
assertApprovedSource(dcSource, jsxSource);

await rm(outputRoot, { recursive: true, force: true });
const frameRoot = path.join(outputRoot, ".frames");
const mediaRoot = path.join(outputRoot, "media");
await mkdir(frameRoot, { recursive: true });
await mkdir(mediaRoot, { recursive: true });

for (let frame = 0; frame < frameCount; frame += 1) {
  const time = frame / fps;
  const png = new Resvg(eyeSvg(time), { fitTo: { mode: "original" } }).render().asPng();
  await writeFile(path.join(frameRoot, `frame-${String(frame).padStart(3, "0")}.png`), png);
}

const profiles = [
  { id: "original", label: "Origineel", width: 1080, height: 900 },
  { id: "instagram-feed", label: "Instagram / Facebook Feed", width: 1080, height: 1350 },
  { id: "story-reel", label: "Instagram / Facebook Story / Reel", width: 1080, height: 1920 },
  { id: "pinterest", label: "Pinterest", width: 1000, height: 1500 },
  { id: "square", label: "Instagram / Facebook Square", width: 1080, height: 1080 }
];

const inputPattern = path.join(frameRoot, "frame-%03d.png");
await renderTransparentWebm(inputPattern, path.join(mediaRoot, "eye-loop-3a-transparent.webm"));
for (const profile of profiles) {
  await renderMp4(inputPattern, path.join(mediaRoot, `eye-loop-3a-${profile.id}.mp4`), profile.width, profile.height);
}
await copyFile(path.join(frameRoot, "frame-000.png"), path.join(mediaRoot, "eye-loop-3a-poster.png"));

const outputs = [];
for (const file of (await readdir(mediaRoot)).filter((name) => /\.(?:mp4|webm)$/i.test(name)).sort()) {
  const probe = JSON.parse((await runFile("ffprobe", ["-v", "error", "-show_entries", "format=duration,size:stream=codec_name,codec_type,width,height,r_frame_rate,pix_fmt", "-of", "json", path.join(mediaRoot, file)], { maxBuffer: 1024 * 1024 })).stdout);
  const video = probe.streams.find((stream) => stream.codec_type === "video");
  const expected = file.endsWith(".webm") ? { width: 1080, height: 900 } : profiles.find((profile) => file.includes(`-${profile.id}.mp4`));
  const errors = [];
  if (!expected || video?.width !== expected.width || video?.height !== expected.height) errors.push("wrong dimensions");
  if (Math.abs(Number(probe.format.duration) - duration) > 0.05) errors.push("wrong duration");
  if (video?.r_frame_rate !== "30/1") errors.push("wrong frame rate");
  outputs.push({ file: `media/${file}`, width: video?.width, height: video?.height, duration_seconds: Number(probe.format.duration), frame_rate: video?.r_frame_rate, codec: video?.codec_name, pixel_format: video?.pix_fmt, bytes: Number(probe.format.size), qa: errors.length ? "failed" : "passed", errors });
}

const report = {
  content_id: "dopa-eye-loop-3a-approved-proof",
  status: outputs.every((output) => output.qa === "passed") ? "passed" : "failed",
  approved_reference: path.basename(zipPath),
  approved_source: "Eye Loop 3a.dc.html + eye-loop.jsx",
  source_sha256: { dc_html: sha256(dcSource), jsx: sha256(jsxSource) },
  animation: { duration_seconds: duration, frame_rate: fps, frames: frameCount, canvas: { width: 1080, height: 900 }, background: "transparent", composition_change: "none; target canvases contain and center the approved source" },
  outputs
};
await writeFile(path.join(outputRoot, "qa-report.json"), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(path.join(outputRoot, "index.html"), reviewHtml(profiles));
await writeFile(path.join(outputRoot, "netlify.toml"), `[build]\n  publish = "."\n\n[[headers]]\n  for = "/*"\n  [headers.values]\n    X-Content-Type-Options = "nosniff"\n    Referrer-Policy = "no-referrer"\n    Content-Security-Policy = "default-src 'self'; media-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'"\n`);
await rm(frameRoot, { recursive: true, force: true });

if (report.status !== "passed") throw new Error(`Animation QA failed: ${JSON.stringify(outputs.filter((output) => output.qa === "failed"))}`);
console.log(JSON.stringify({ page: path.join(outputRoot, "index.html"), qa: report.status, outputs: outputs.length }, null, 2));

function validateEntries(items) {
  if (!items.length || items.length > 500) throw new Error(`Unsafe ZIP entry count: ${items.length}`);
  for (const entry of items) {
    if (!entry || entry.includes("\0") || entry.includes("\\") || path.posix.isAbsolute(entry) || entry.split("/").includes("..")) throw new Error(`Unsafe ZIP entry: ${entry}`);
  }
}

function assertApprovedSource(dc, jsx) {
  const dcChecks = ["dur\":3.6", "mode\":\"loop", "iris=\"#FF3D88\"", "highlight=\"#FAF4E8\"", "w: 1080", "h: 900", "bg=\"transparent\""];
  const jsxChecks = ["const period = 3.6", "13 * Math.sin", "2 * Math.PI / 5.2", "stroke=\"#FF3D88\"", "d=\"M42,74 L27,47\""];
  const missing = [...dcChecks.filter((value) => !dc.includes(value)), ...jsxChecks.filter((value) => !jsx.includes(value))];
  if (missing.length) throw new Error(`Animation source differs from the approved 3a contract: ${missing.join(", ")}`);
}

function eyeSvg(time) {
  const phase = (time % 3.6) / 3.6;
  const eyeScaleY = pw(phase, [[0, 1], [.8, 1], [.85, 1.1], [.9, .05], [.94, .05], [1, 1]]);
  const lashY = pw(phase, [[0, 0], [.8, 0], [.85, -4], [.9, 56], [.94, 56], [.97, -6], [1, 0]]);
  const lashScaleY = pw(phase, [[0, 1], [.8, 1], [.85, 1.08], [.9, .3], [.94, .3], [.97, 1.06], [1, 1]]);
  const pupilScale = pw(phase, [[0, 1], [.8, 1], [.85, 1.18], [.9, .35], [.94, .35], [1, 1]]);
  const lookX = 13 * Math.sin(time * (2 * Math.PI / 5.2));
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="900" viewBox="0 0 1080 900">
  <defs><filter id="shadow" x="-30%" y="-30%" width="160%" height="180%"><feDropShadow dx="0" dy="10" stdDeviation="7" flood-color="#1A1A1A" flood-opacity="0.18"/></filter></defs>
  <g transform="translate(162 135) scale(3.15)" filter="url(#shadow)">
    <g transform="translate(120 100) scale(1 ${n(eyeScaleY)}) translate(-120 -100)">
      <path d="M15,100 Q120,32 225,100 Q120,168 15,100 Z" fill="#FAF4E8" stroke="#FF3D88" stroke-width="7"/>
      <g transform="translate(${n(lookX)} 0)">
        <circle cx="120" cy="100" r="34" fill="#FF3D88"/>
        <circle cx="120" cy="100" r="15" fill="#1A1A1A" transform="translate(120 100) scale(${n(pupilScale)}) translate(-120 -100)"/>
        <circle cx="111" cy="90" r="6" fill="#FAF4E8"/>
      </g>
    </g>
    <g transform="translate(120 60) translate(0 ${n(lashY)}) scale(1 ${n(lashScaleY)}) translate(-120 -60)">
      <path d="M15,100 Q120,32 225,100" fill="none" stroke="#FF3D88" stroke-width="7" stroke-linecap="round"/>
      <path d="M42,74 L27,47 M74,50 L65,20 M108,38 L104,7 M143,38 L148,7 M176,50 L186,20 M206,74 L222,47" fill="none" stroke="#FF3D88" stroke-width="8" stroke-linecap="round"/>
    </g>
  </g>
</svg>\n`;
}

function reviewHtml(allProfiles) {
  const tabs = allProfiles.map((profile, index) => `<button type="button" data-tab="${profile.id}" aria-pressed="${index === 0}">${profile.label} · ${profile.width}×${profile.height}</button>`).join("");
  const panels = allProfiles.map((profile, index) => `<section class="panel${index === 0 ? " active" : ""}" data-panel="${profile.id}"><div class="panel-head"><div><span class="eyebrow">Goedgekeurde beweging · variant 3a</span><h2>${profile.label}</h2></div><p>Links staat de transparante bron op een controlepatroon. Rechts staat de downloadbare MP4 op de donkere preview-achtergrond uit de schermreferentie.</p></div><div class="compare"><figure><figcaption>Origineel · 1080×900 · transparant</figcaption><div class="stage checker" style="--ratio:1080/900"><video autoplay muted loop playsinline controls poster="media/eye-loop-3a-poster.png"><source src="media/eye-loop-3a-transparent.webm" type="video/webm"></video></div><a class="download" href="media/eye-loop-3a-transparent.webm" download>download transparante WebM</a></figure><figure><figcaption>${profile.label} · ${profile.width}×${profile.height} · MP4</figcaption><div class="stage ink" style="--ratio:${profile.width}/${profile.height}"><video autoplay muted loop playsinline controls><source src="media/eye-loop-3a-${profile.id}.mp4" type="video/mp4"></video></div><a class="download" href="media/eye-loop-3a-${profile.id}.mp4" download>download ${profile.width}×${profile.height} MP4</a></figure></div></section>`).join("");
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dopa · animatieproef</title><style>:root{--cream:#faf4e8;--paper:#fffdf8;--ink:#1a1a1a;--muted:#6b6861;--line:#d9d3c8;--pink:#ff3d88}*{box-sizing:border-box}body{margin:0;background:var(--cream);color:var(--ink);font-family:Arial,sans-serif}main{max-width:1400px;margin:auto;padding:28px}.top{display:flex;justify-content:space-between;gap:24px;border-bottom:2px solid var(--ink);padding-bottom:22px}.top h1{font-size:clamp(34px,5vw,64px);line-height:.95;letter-spacing:-.05em;margin:0}.top p,.panel-head p{max-width:650px;color:var(--muted);line-height:1.5}.badge{white-space:nowrap;border:1px solid var(--pink);color:#b11256;border-radius:999px;padding:9px 12px;font-weight:700;height:min-content}.tabs{display:flex;gap:8px;flex-wrap:wrap;margin:22px 0}.tabs button{border:1px solid var(--ink);background:var(--paper);border-radius:999px;padding:10px 13px;font-weight:700;cursor:pointer}.tabs button[aria-pressed=true]{background:var(--ink);color:white}.panel{display:none}.panel.active{display:block}.panel-head{display:flex;justify-content:space-between;align-items:end;gap:24px;margin:24px 0}.panel-head h2{font-size:34px;margin:4px 0 0}.eyebrow,figcaption{font:700 11px monospace;color:var(--muted);text-transform:uppercase}.compare{display:grid;grid-template-columns:1fr 1fr;gap:20px;background:var(--paper);border:1px solid var(--line);border-radius:14px;padding:16px;align-items:start}figure{margin:0;min-width:0}figcaption{margin-bottom:8px}.stage{width:100%;aspect-ratio:var(--ratio);border:1px solid var(--line);border-radius:8px;overflow:hidden}.checker{background-color:#eee;background-image:linear-gradient(45deg,#ccc 25%,transparent 25%),linear-gradient(-45deg,#ccc 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#ccc 75%),linear-gradient(-45deg,transparent 75%,#ccc 75%);background-size:28px 28px;background-position:0 0,0 14px,14px -14px,-14px 0}.ink{background:var(--ink)}video{display:block;width:100%;height:100%;object-fit:contain}.download{display:inline-block;margin-top:10px;background:var(--pink);color:white;text-decoration:none;font-weight:700;border-radius:999px;padding:10px 14px}.note{margin-top:22px;padding:15px 17px;border:1px solid #d6b93d;background:#fff3c4;border-radius:12px;line-height:1.45}@media(max-width:760px){main{padding:18px}.top,.panel-head{display:block}.badge{display:inline-block;margin-top:14px}.compare{grid-template-columns:1fr}}</style></head><body><main><section class="top"><div><h1>dopa. moving eye proof</h1><p>Gebouwd vanuit de originele Claude Design-ZIP. De telefoonvideo is uitsluitend gebruikt om variant 3a en de goedgekeurde beweging te identificeren.</p></div><span class="badge">3,6 sec · 30 fps · 5 formaten</span></section><nav class="tabs">${tabs}</nav>${panels}<div class="note"><strong>Geen uitrekking of redesign.</strong> De bronanimatie blijft gecentreerd en volledig zichtbaar. Voor MP4 is de donkere referentieachtergrond gebruikt; de WebM behoudt transparantie.</div></main><script>for(const tab of document.querySelectorAll('[data-tab]'))tab.onclick=()=>{for(const item of document.querySelectorAll('[data-tab]'))item.setAttribute('aria-pressed',String(item===tab));for(const panel of document.querySelectorAll('[data-panel]'))panel.classList.toggle('active',panel.dataset.panel===tab.dataset.tab)}</script></body></html>`;
}

async function renderTransparentWebm(input, output) {
  await runFile("ffmpeg", ["-y", "-v", "error", "-framerate", String(fps), "-i", input, "-frames:v", String(frameCount), "-c:v", "libvpx-vp9", "-lossless", "1", "-pix_fmt", "yuva420p", "-auto-alt-ref", "0", "-an", output], { maxBuffer: 8 * 1024 * 1024 });
}

async function renderMp4(input, output, width, height) {
  const scale = Math.min(width / 1080, height / 900);
  const scaledWidth = even(Math.round(1080 * scale));
  const scaledHeight = even(Math.round(900 * scale));
  const filter = `[0:v]scale=${scaledWidth}:${scaledHeight}:flags=lanczos,format=rgba[fg];color=c=0x${ink}:s=${width}x${height}:r=${fps}:d=${duration}[bg];[bg][fg]overlay=(W-w)/2:(H-h)/2:format=auto,format=yuv420p[out]`;
  await runFile("ffmpeg", ["-y", "-v", "error", "-framerate", String(fps), "-i", input, "-filter_complex", filter, "-map", "[out]", "-frames:v", String(frameCount), "-c:v", "libx264", "-crf", "16", "-preset", "medium", "-movflags", "+faststart", "-an", output], { maxBuffer: 8 * 1024 * 1024 });
}

async function unzipText(args) {
  return (await runFile("unzip", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 })).stdout;
}

function pw(phase, points) {
  for (let index = 0; index < points.length - 1; index += 1) {
    const [p0, v0] = points[index];
    const [p1, v1] = points[index + 1];
    if (phase >= p0 && phase <= p1) return v0 + (v1 - v0) * ((phase - p0) / (p1 - p0 || 1));
  }
  return points.at(-1)[1];
}

function n(value) { return Number(value.toFixed(6)); }
function even(value) { return value % 2 === 0 ? value : value - 1; }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
