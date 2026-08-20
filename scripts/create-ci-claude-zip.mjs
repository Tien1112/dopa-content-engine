import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const output = path.resolve(process.argv[2] ?? "work/ci-input.zip");
const fixtureRoot = await mkdtemp(path.join(tmpdir(), "dopa-ci-zip-"));
const uploads = path.join(fixtureRoot, "uploads");
await mkdir(uploads, { recursive: true });

const squarePages = [
  { label: "01", title: "render what was approved", accent: "#ff3d88" },
  { label: "02", title: "exact means exact", accent: "#12c2da" },
  { label: "03", title: "qa before publish", accent: "#ffe94a" }
];

const html = `<!doctype html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box}html,body{margin:0}body{display:flex;flex-direction:column;gap:32px;background:#ddd}section{width:1080px;height:1080px;padding:96px;background:#faf4e8;color:#1a1a1a;display:flex;flex-direction:column;justify-content:center;font-family:Arial,sans-serif}h1{font-size:112px;line-height:.94;margin:0;max-width:850px}.dot{width:36px;height:36px;display:inline-block;margin-left:12px}</style></head><body>${squarePages.map((page) => `<section data-document-role="page" data-label="${page.label}" style="width:1080px; height:1080px"><h1>${page.title}<span class="dot" style="background:${page.accent}"></span></h1></section>`).join("")}</body></html>`;
await writeFile(path.join(fixtureRoot, "ci-export-bundled.html"), html);

const browser = await chromium.launch({ headless: true });
try {
  for (const [index, item] of squarePages.entries()) {
    const context = await browser.newContext({ viewport: { width: 2000, height: 3000 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><style>*{box-sizing:border-box}html,body{margin:0;width:2000px;height:3000px;background:#faf4e8;color:#1a1a1a;font-family:Arial,sans-serif}main{width:100%;height:100%;padding:180px;display:flex;align-items:center}h1{font-size:190px;line-height:.94;margin:0;max-width:1500px}.dot{display:inline-block;width:64px;height:64px;margin-left:18px;background:${item.accent}}</style><main><h1>${item.title}<span class="dot"></span></h1></main></html>`);
    await page.screenshot({ path: path.join(uploads, `ci-${String(index + 1).padStart(2, "0")}.png`), type: "png", omitBackground: true });
    await context.close();
  }
} finally {
  await browser.close();
}

await mkdir(path.dirname(output), { recursive: true });
await new Promise((resolve, reject) => {
  execFile("zip", ["-qr", output, "."], { cwd: fixtureRoot }, (error) => error ? reject(error) : resolve());
});
console.log(output);
