import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const reportPath = path.resolve(process.argv[2] ?? "");
if (!reportPath) throw new Error("Usage: node scripts/create-contact-sheet.mjs <qa-report.json>");
const report = JSON.parse(await readFile(reportPath, "utf8"));
const renderRoot = path.dirname(reportPath);
const htmlPath = path.join(renderRoot, "contact-sheet.html");
const outputPath = path.join(renderRoot, "contact-sheet.png");
const cards = report.outputs.map((output) => `<figure><img src="${path.basename(output.file)}" alt="${escapeHtml(output.page_label ?? output.preset)}"><figcaption>${escapeHtml(output.page_label ?? output.preset)} · ${output.width}×${output.height} · ${output.qa}</figcaption></figure>`).join("");
await writeFile(htmlPath, `<!doctype html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;padding:32px;background:#eceae5;color:#1a1a1a;font-family:Arial,sans-serif}h1{font-size:24px;margin:0 0 24px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:22px}figure{margin:0;padding:12px;background:white;border:1px solid #ccc}img{display:block;width:100%;height:auto}figcaption{font-size:12px;margin-top:8px}</style></head><body><h1>${escapeHtml(report.content_id)} · ${escapeHtml(report.status)}</h1><div class="grid">${cards}</div></body></html>`);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
  await page.screenshot({ path: outputPath, type: "png", fullPage: true });
} finally {
  await browser.close();
}
console.log(outputPath);

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
