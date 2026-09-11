import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { renderJob } from "../src/core/render.js";

test("captures a real CSS animation as a moving Reel MP4", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "dopa-animated-render-"));
  await mkdir(path.join(root, "source"));
  await writeFile(path.join(root, "source", "index.html"), `<!doctype html><style>
    html,body{margin:0;background:#111} @keyframes move{from{transform:translateX(0)}to{transform:translateX(700px)}}
    [data-document-role=page]{position:relative;width:1080px;height:1920px;overflow:hidden}
    .dot{position:absolute;top:700px;width:300px;height:300px;border-radius:50%;background:#ff3d88;animation:move 1s linear infinite}
  </style><section data-document-role="page" data-label="animated"><div class="dot"></div></section>`);
  const manifest = {
    schema_version: 1, content_id: "animated-proof", brand: "dopa", version: 1,
    source: "source/index.html", canvas: { width: 1080, height: 1920 },
    pages: { selector: "[data-document-role=page]", label_attribute: "data-label", maximum: 1 },
    animation: true, outputs: [{ preset: "instagram_reel", mode: "exact", duration_seconds: 1, frame_rate: 2 }]
  };
  const manifestPath = path.join(root, "manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest));
  const report = await renderJob(manifestPath);
  assert.equal(report.status, "passed", JSON.stringify(report.outputs));
  assert.equal(report.outputs[0]?.format, "mp4");
  assert.ok((await readFile(path.join(root, report.outputs[0]!.file))).length > 0);
});
