import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { prepareClaudeDesignZip } from "../dist/src/adapters/claude-design-zip.js";

const zipPath = path.resolve(process.argv[2] ?? "");
const outputRoot = path.resolve(process.argv[3] ?? "work/dopa-approval");
if (!zipPath) throw new Error("Usage: node scripts/create-local-approval.mjs <claude-design.zip> [output-directory]");

const preparedRoot = path.join(outputRoot, "prepared");
const productionRoot = path.join(outputRoot, "production", "pinterest");
await mkdir(productionRoot, { recursive: true });
const prepared = await prepareClaudeDesignZip(zipPath, preparedRoot, "dopa-dispatch");
if (!prepared.pinterest) throw new Error("No approved 2:3 Pinterest designs were found in the ZIP");

const sourceRoot = path.join(preparedRoot, "pinterest-source", "source", "assets");
const assets = (await readdir(sourceRoot)).filter((name) => name.toLowerCase().endsWith(".png")).sort();
const records = [];
for (const filename of assets) {
  const source = path.join(sourceRoot, filename);
  const output = path.join(productionRoot, filename);
  await run("sips", ["-z", "1500", "1000", source, "--out", output]);
  const sourceMeta = pngMeta(await readFile(source));
  const outputMeta = pngMeta(await readFile(output));
  if (sourceMeta.width * 3 !== sourceMeta.height * 2) throw new Error(`Source is not 2:3: ${filename}`);
  if (outputMeta.width !== 1000 || outputMeta.height !== 1500) throw new Error(`Output is not 1000x1500: ${filename}`);
  records.push({ id: path.parse(filename).name, filename, sourceMeta, outputMeta });
}

const cards = records.map((record) => `
  <article class="design blocked" data-design="${escapeHtml(record.id)}">
    <header><div><span class="number">${escapeHtml(record.id)}</span><h2>${escapeHtml(humanize(record.id))}</h2></div><span class="status" data-status>geblokkeerd</span></header>
    <div class="compare">
      <figure><figcaption>goedgekeurde bron · ${record.sourceMeta.width}×${record.sourceMeta.height}</figcaption><img src="prepared/pinterest-source/source/assets/${encodeURIComponent(record.filename)}" alt="Goedgekeurde bron voor ${escapeHtml(record.id)}"></figure>
      <figure><figcaption>productie-preview · ${record.outputMeta.width}×${record.outputMeta.height}</figcaption><img src="production/pinterest/${encodeURIComponent(record.filename)}" alt="Productie-preview voor ${escapeHtml(record.id)}"></figure>
    </div>
    <div class="actions" role="group" aria-label="Beoordeling voor ${escapeHtml(record.id)}">
      <button type="button" data-choice="approved" disabled>goedkeuren</button>
      <button type="button" data-choice="rejected" disabled>opnieuw</button>
      <input type="text" data-note placeholder="wacht op juiste compositie" aria-label="Opmerking voor ${escapeHtml(record.id)}" disabled>
    </div>
  </article>`).join("");

const formatCard = (platform, name, size, note, state = "pending") => `
  <article class="format-card" data-format-state="${state}">
    <div><span class="eyebrow">${escapeHtml(platform)}</span><h3>${escapeHtml(name)}</h3></div>
    <strong>${escapeHtml(size)}</strong>
    <p>${escapeHtml(note)}</p>
    <span class="format-status">${state === "separate" ? "aparte workflow" : "wacht op compositie"}</span>
  </article>`;

const html = `<!doctype html>
<html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dopa · lokale design approval</title>
<style>
:root{color-scheme:light;--cream:#faf4e8;--paper:#fffdf8;--ink:#1a1a1a;--muted:#696761;--line:#d9d3c8;--pink:#ff3d88;--green:#2d6b52;--yellow:#ffe94a;--red:#a43434}*{box-sizing:border-box}body{margin:0;background:var(--cream);color:var(--ink);font-family:Arial,sans-serif}main{max-width:1440px;margin:auto;padding:32px}.top{display:flex;justify-content:space-between;gap:24px;align-items:flex-start;border-bottom:2px solid var(--ink);padding-bottom:24px;margin-bottom:24px}h1{font-size:clamp(32px,5vw,64px);line-height:.95;margin:0;letter-spacing:-.05em;max-width:750px}.intro{color:var(--muted);max-width:600px;line-height:1.5;margin:8px 0 0}.summary{display:flex;gap:18px;flex-wrap:wrap;margin:18px 0 28px}.summary span{font-weight:700}.tabs{display:flex;gap:8px;margin-bottom:24px;flex-wrap:wrap}.tabs button,.actions button,.export{border:1px solid var(--ink);background:var(--paper);color:var(--ink);padding:10px 14px;border-radius:999px;font-weight:700;cursor:pointer}.tabs button[aria-pressed=true]{background:var(--ink);color:var(--paper)}.panel{display:none}.panel.active{display:block}.notice{background:#fff3c4;border:1px solid #d6b93d;border-radius:14px;padding:16px 18px;margin-bottom:22px;line-height:1.45}.format-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.format-card{background:var(--paper);border:1px solid var(--line);border-radius:14px;padding:20px;display:grid;grid-template-columns:1fr auto;gap:8px 18px;align-items:start}.format-card h3{margin:4px 0 0;font-size:22px}.format-card>strong{font:700 13px monospace;border:1px solid var(--ink);border-radius:999px;padding:7px 9px}.format-card p{color:var(--muted);line-height:1.45;margin:4px 0;grid-column:1/-1}.eyebrow{font:700 11px monospace;color:var(--muted);text-transform:uppercase}.format-status{font-size:12px;font-weight:700;color:var(--red);grid-column:1/-1}.design{background:var(--paper);border:1px solid var(--line);border-radius:14px;padding:18px;margin-bottom:22px}.design.blocked{border-color:#d6b93d}.design header{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:14px}.design h2{margin:3px 0 0;font-size:18px}.number{font:700 11px monospace;color:var(--muted);text-transform:uppercase}.status{font-size:12px;font-weight:700;border:1px solid var(--red);color:var(--red);border-radius:999px;padding:6px 10px}.compare{display:grid;grid-template-columns:1fr 1fr;gap:18px}.compare figure{margin:0}.compare figcaption{font:700 11px monospace;color:var(--muted);margin-bottom:8px}.compare img{width:100%;height:auto;display:block;border:1px solid var(--line);border-radius:8px;background:var(--cream)}.actions{display:grid;grid-template-columns:auto auto 1fr;gap:8px;margin-top:14px}.actions button:disabled,.actions input:disabled{opacity:.45;cursor:not-allowed}.actions input{min-width:0;border:1px solid var(--line);border-radius:999px;padding:10px 14px;background:white;color:var(--ink)}.pending{border:1px solid var(--line);border-radius:14px;background:var(--paper);padding:22px;max-width:900px}.pending h2{font-size:28px;margin:0 0 10px}.pending ul{line-height:1.7}.foot{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:28px;padding-top:20px;border-top:1px solid var(--line)}@media(max-width:760px){main{padding:20px}.top{display:block}.compare,.format-grid{grid-template-columns:1fr}.actions{grid-template-columns:1fr 1fr}.actions input{grid-column:1/-1}}
</style></head><body><main>
<section class="top"><div><h1>dopa. lokale design approval</h1><p class="intro">Hier komen alle productieformaten samen. Een formaat wordt pas goed te keuren en te downloaden nadat de compositie vanuit het vierkante brondesign correct is opgebouwd.</p></div><button class="export" id="export" type="button">download approval JSON</button></section>
<div class="summary"><span>${records.length} vierkante bronontwerpen</span><span>9 productieprofielen</span><span>0 gereed voor download</span></div>
<nav class="tabs" aria-label="Kanalen"><button type="button" aria-pressed="true" data-tab="overview">Alle formaten</button><button type="button" aria-pressed="false" data-tab="instagram">Instagram</button><button type="button" aria-pressed="false" data-tab="facebook">Facebook</button><button type="button" aria-pressed="false" data-tab="pinterest">Pinterest</button><button type="button" aria-pressed="false" data-tab="youtube">YouTube</button><button type="button" aria-pressed="false" data-tab="merchant">Google Merchant</button></nav>
<section class="panel active" data-panel="overview"><div class="format-grid">
${formatCard("Instagram", "Feed post", "1080×1350 · 4:5", "Verticale social compositie voor de Instagram-feed.")}
${formatCard("Instagram", "Story / Reel", "1080×1920 · 9:16", "Volledig scherm met veilige ruimte voor de interface.")}
${formatCard("Facebook", "Feed post", "1080×1350 · 4:5", "Dopa-productieprofiel voor de mobiele Facebook-feed.")}
${formatCard("Facebook", "Story / Reel", "1080×1920 · 9:16", "Volledig scherm met veilige ruimte boven en onder.")}
${formatCard("Pinterest", "Standard Pin", "1000×1500 · 2:3", "De huidige ZIP-PNG's wijken af; dit profiel wordt opnieuw opgebouwd.")}
${formatCard("YouTube", "Video thumbnail", "3840×2160 · 16:9", "Brede thumbnailcompositie voor gewone YouTube-video's.")}
${formatCard("YouTube", "Shorts creative", "1080×1920 · 9:16", "Verticale basis voor een Short; video en geluid volgen later.")}
${formatCard("Google Merchant", "Main product image", "1500×1500 · 1:1", "Echte productfoto zonder promotietekst of los logo; geen quote-poster.", "separate")}
${formatCard("Google Merchant", "Additional product image", "1500×1500 · 1:1", "Lifestyle- of detailbeeld van het daadwerkelijke product.", "separate")}
</div></section>
<section class="panel" data-panel="instagram"><div class="pending"><h2>Instagram</h2><ul><li>Feed post · 1080×1350</li><li>Story / Reel · 1080×1920</li></ul><p>Deze composities worden apart opgebouwd vanuit het vierkante 1080×1080-brondesign.</p></div></section>
<section class="panel" data-panel="facebook"><div class="pending"><h2>Facebook</h2><ul><li>Feed post · 1080×1350</li><li>Story / Reel · 1080×1920</li></ul><p>Waar de compositie gelijk is aan Instagram kan hetzelfde gecontroleerde bestand worden hergebruikt.</p></div></section>
<section class="panel" data-panel="pinterest"><div class="notice"><strong>Nog niet goedkeuren.</strong> Links en rechts staan nu verticale PNG's uit de ZIP. Die komen niet overeen met de vierkante designs uit de screenshot. Deze vergelijking blijft zichtbaar als diagnose, maar de knoppen zijn geblokkeerd totdat de juiste composities zijn gemaakt.</div>${cards}</section>
<section class="panel" data-panel="youtube"><div class="pending"><h2>YouTube</h2><ul><li>Video thumbnail · 3840×2160</li><li>Shorts creative · 1080×1920</li></ul><p>Een statisch Story-beeld kan later als basis dienen voor animatie, maar is nog geen kant-en-klare Short.</p></div></section>
<section class="panel" data-panel="merchant"><div class="pending"><h2>Google Merchant is een aparte beeldstroom</h2><p>Merchant gebruikt echte productafbeeldingen. De quote-posters mogen niet als hoofdafbeelding worden gebruikt. We voegen hier later de Shopify-, Printful- of Gelato-productbeelden toe.</p><ul><li>Main product image · bij voorkeur 1500×1500 of groter</li><li>Additional product images · 1500×1500 of groter</li></ul></div></section>
<div class="foot"><span>privé en lokaal · bron: ${escapeHtml(path.basename(zipPath))}</span><span>status: composities nog te bouwen</span></div>
</main><script>
const key='dopa-approval-v1';const state=JSON.parse(localStorage.getItem(key)||'{}');
const cards=[...document.querySelectorAll('.design')];
function render(){for(const card of cards){card.dataset.state='blocked';card.querySelector('[data-status]').textContent='geblokkeerd';}localStorage.setItem(key,JSON.stringify(state));}
for(const tab of document.querySelectorAll('[data-tab]'))tab.addEventListener('click',()=>{for(const t of document.querySelectorAll('[data-tab]'))t.setAttribute('aria-pressed',String(t===tab));for(const panel of document.querySelectorAll('[data-panel]'))panel.classList.toggle('active',panel.dataset.panel===tab.dataset.tab);});
document.getElementById('export').addEventListener('click',()=>{const blob=new Blob([JSON.stringify({created_at:new Date().toISOString(),source:${JSON.stringify(path.basename(zipPath))},decisions:state},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='dopa-approval.json';a.click();URL.revokeObjectURL(a.href);});render();
</script></body></html>`;
await writeFile(path.join(outputRoot, "index.html"), html);
await writeFile(path.join(outputRoot, "qa-summary.json"), `${JSON.stringify({ status: "passed", pinterest: records.map((record) => ({ id: record.id, source: record.sourceMeta, output: record.outputMeta, qa: "passed" })), missing: prepared.missing_approved_compositions }, null, 2)}\n`);
console.log(JSON.stringify({ url_path: path.join(outputRoot, "index.html"), pinterest: records.length, qa: "passed", missing: prepared.missing_approved_compositions }, null, 2));

function pngMeta(buffer){if(buffer.length<26||!buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new Error('Invalid PNG');return{width:buffer.readUInt32BE(16),height:buffer.readUInt32BE(20),alpha:[4,6].includes(buffer[25])}}
function run(command,args){return new Promise((resolve,reject)=>execFile(command,args,{maxBuffer:1024*1024},(error,stdout,stderr)=>error?reject(new Error(String(stderr||error.message))):resolve(stdout)))}
function humanize(value){return value.replace(/^q\d+-/,'').replace(/^\d+[a-z]?-/, '').replaceAll('-',' ')}
function escapeHtml(value){return String(value).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;')}
