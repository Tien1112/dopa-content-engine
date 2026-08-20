import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const sourceRoot = path.resolve(process.argv[2] ?? "");
const outputRoot = path.resolve(process.argv[3] ?? "work/pinterest-reflow-proof");
if (!sourceRoot) throw new Error("Usage: node scripts/create-pinterest-reflow-proof.mjs <claude-export-directory> [output-directory]");

const sourceFile = path.join(sourceRoot, "DopaPins-canva-export.html");
const sourceHtml = await readFile(sourceFile, "utf8");
const head = sourceHtml.match(/<head[^>]*>([\s\S]*?)<\/head>/i)?.[1];
if (!head) throw new Error("Could not read the source document head");
const localizedHead = localizeHead(head);
const sections = extractPageSections(sourceHtml);
if (sections.length !== 36) throw new Error(`Expected 36 approved Pinterest pages, found ${sections.length}`);

const samples = [
  pick("a little wild"),
  pick("you are the 9 traits"),
  pick("thank you beautiful brain")
];
const profiles = [
  { id: "pinterest", name: "Pinterest", width: 1000, height: 1500 },
  { id: "instagram-feed", name: "Instagram / Facebook Feed", width: 1080, height: 1350 },
  { id: "story", name: "Instagram / Facebook Story", width: 1080, height: 1920 },
  { id: "square", name: "Instagram / Facebook Square", width: 1080, height: 1080 }
];

await mkdir(outputRoot, { recursive: true });
await cp(path.join(sourceRoot, "pins"), path.join(outputRoot, "pins"), { recursive: true });
await cp(path.resolve("brands/dopa/fonts"), path.join(outputRoot, "fonts"), { recursive: true });
const proofRecords = [];
for (const profile of profiles) {
  const profileRoot = path.join(outputRoot, "proofs", profile.id);
  await mkdir(profileRoot, { recursive: true });
  for (const sample of samples) {
    const filename = `${sample.slug}.html`;
    const section = adaptRootCanvas(sample.section, profile.width, profile.height);
    const isolated = isolatedDocument(localizedHead, section, profile.width, profile.height);
    await writeFile(path.join(profileRoot, filename), isolated);
    proofRecords.push({ ...profile, label: sample.label, slug: sample.slug, file: `proofs/${profile.id}/${filename}` });
  }
}

await writeFile(path.join(outputRoot, "proof-manifest.json"), `${JSON.stringify({ source: sourceFile, total_designs: sections.length, samples: samples.map(({ label, slug }) => ({ label, slug })), profiles, proofs: proofRecords }, null, 2)}\n`);
await writeFile(path.join(outputRoot, "index.html"), reviewPage(profiles, samples));
console.log(JSON.stringify({ page: path.join(outputRoot, "index.html"), source_pages: sections.length, sample_designs: samples.length, profiles: profiles.length }, null, 2));

function pick(fragment) {
  const section = sections.find((candidate) => labelOf(candidate).toLowerCase().includes(fragment));
  if (!section) throw new Error(`Missing sample containing: ${fragment}`);
  const label = labelOf(section);
  return { section, label, slug: slugify(label) };
}

function extractPageSections(html) {
  const starts = [...html.matchAll(/<section\b[^>]*data-document-role="page"[^>]*>/gi)];
  return starts.map((start) => {
    const tagPattern = /<section\b[^>]*>|<\/section>/gi;
    tagPattern.lastIndex = start.index;
    let depth = 0;
    let match;
    while ((match = tagPattern.exec(html))) {
      depth += match[0].startsWith("</") ? -1 : 1;
      if (depth === 0) return html.slice(start.index, tagPattern.lastIndex);
    }
    throw new Error(`Unclosed page section at byte ${start.index}`);
  });
}

function adaptRootCanvas(section, width, height) {
  return section.replace(/(<section\b[^>]*data-document-role="page"[^>]*style=")([^"]*)(")/i, (_all, before, style, after) => {
    const adapted = style
      .replace(/width:\s*1000px/i, `width:${width}px`)
      .replace(/height:\s*1500px/i, `height:${height}px`)
      .replace(/border-radius:\s*10px;?/i, "border-radius:0;")
      .replace(/box-shadow:\s*[^;]+;?/i, "box-shadow:none;")
      .replace(/margin:\s*[^;]+;?/i, "margin:0;");
    return `${before}${adapted}${after}`;
  });
}

function localizeHead(originalHead) {
  const withoutGoogleFonts = originalHead
    .replace(/<link\b[^>]*href=["']https:\/\/fonts\.googleapis\.com[^>]*>\s*/gi, "")
    .replace(/<link\b[^>]*href=["']https:\/\/fonts\.gstatic\.com[^>]*>\s*/gi, "");
  return `<link rel="stylesheet" href="/fonts/fonts.css">${withoutGoogleFonts}`;
}

function isolatedDocument(originalHead, section, width, height) {
  return `<!doctype html><html><head>${originalHead}<base href="../../"><style id="dopa-proof-isolation">html,body{margin:0!important;padding:0!important;width:100%;height:100%;overflow:hidden!important;background:#FAF4E8!important}body{position:relative!important;display:block!important}section[data-document-role=page]{position:absolute!important;left:0!important;top:0!important;margin:0!important;transform-origin:0 0!important}</style></head><body>${section}<script>(()=>{const targetW=${width},targetH=${height},sourceW=1000,sourceH=1500,page=document.querySelector('[data-document-role=page]');let mode='reflow';function clipped(){const p=page.getBoundingClientRect();return [...page.querySelectorAll('*')].some(el=>{const r=el.getBoundingClientRect();return r.width>1&&r.height>1&&(r.left<p.left-1||r.top<p.top-1||r.right>p.right+1||r.bottom>p.bottom+1)})}function fit(){const w=mode==='contain'?sourceW:targetW,h=mode==='contain'?sourceH:targetH,scale=Math.min(innerWidth/w,innerHeight/h);page.style.transform='scale('+scale+')';page.style.left=((innerWidth-w*scale)/2)+'px';page.style.top=((innerHeight-h*scale)/2)+'px'}async function layout(){await document.fonts.ready;page.style.transform='none';page.style.left='0';page.style.top='0';if(clipped()){mode='contain';page.style.width=sourceW+'px';page.style.height=sourceH+'px';page.dataset.dopaLayout='contain-fallback';document.documentElement.dataset.dopaLayout='contain-fallback'}fit()}addEventListener('resize',fit);layout()})()</script></body></html>`;
}

function reviewPage(allProfiles, allSamples) {
  const tabs = allProfiles.map((profile, index) => `<button type="button" data-tab="${profile.id}" aria-pressed="${index === 0}">${escapeHtml(profile.name)} · ${profile.width}×${profile.height}</button>`).join("");
  const panels = allProfiles.map((profile, index) => `<section class="panel${index === 0 ? " active" : ""}" data-panel="${profile.id}"><div class="panel-head"><div><span class="eyebrow">${escapeHtml(profile.name)}</span><h2>${profile.width}×${profile.height}</h2></div><p>De HTML-bron is opnieuw ingedeeld op dit canvas; dit is geen uitgerekte Pinterest-PNG.</p></div><div class="grid">${allSamples.map((sample) => card(profile, sample)).join("")}</div></section>`).join("");
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dopa · Pinterest redesign proof</title><style>:root{--cream:#faf4e8;--paper:#fffdf8;--ink:#1a1a1a;--muted:#6b6861;--line:#d9d3c8;--green:#2d6b52;--red:#a43434}*{box-sizing:border-box}body{margin:0;background:var(--cream);color:var(--ink);font-family:Arial,sans-serif}main{max-width:1500px;margin:auto;padding:28px}.top{display:flex;justify-content:space-between;gap:24px;border-bottom:2px solid var(--ink);padding-bottom:22px}.top h1{font-size:clamp(34px,5vw,64px);line-height:.95;letter-spacing:-.05em;margin:0}.top p{max-width:650px;color:var(--muted);line-height:1.5}.badge{white-space:nowrap;border:1px solid var(--green);color:var(--green);border-radius:999px;padding:9px 12px;font-weight:700;height:min-content}.tabs{display:flex;gap:8px;flex-wrap:wrap;margin:22px 0}.tabs button,.actions button{border:1px solid var(--ink);background:var(--paper);color:var(--ink);border-radius:999px;padding:10px 13px;font-weight:700;cursor:pointer}.tabs button[aria-pressed=true]{background:var(--ink);color:white}.panel{display:none}.panel.active{display:block}.panel-head{display:flex;justify-content:space-between;align-items:end;gap:24px;margin:24px 0}.panel-head h2{font-size:34px;margin:3px 0 0}.panel-head p{color:var(--muted);max-width:620px}.eyebrow,.label,.compare figcaption{font:700 11px monospace;color:var(--muted);text-transform:uppercase}.grid{display:grid;grid-template-columns:1fr;gap:18px}.card{background:var(--paper);border:1px solid var(--line);border-radius:14px;padding:16px}.card header{display:flex;justify-content:space-between;gap:12px;margin-bottom:12px}.card h3{font-size:18px;margin:3px 0 0}.status{font-size:11px;border:1px solid var(--line);border-radius:999px;padding:6px 8px;height:min-content}.compare{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,2fr);gap:16px;align-items:start}.compare figure{margin:0;min-width:0}.compare figcaption{margin-bottom:7px}.frame{width:100%;aspect-ratio:var(--ratio);border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--cream)}iframe{display:block;width:100%;height:100%;border:0}.actions{display:flex;gap:7px;margin-top:12px}.card[data-state=approved] .status{border-color:var(--green);color:var(--green)}.card[data-state=rejected] .status{border-color:var(--red);color:var(--red)}.card[data-state=approved] [data-choice=approved]{background:var(--green);color:white}.card[data-state=rejected] [data-choice=rejected]{background:var(--red);color:white}.note{margin:24px 0 0;padding:15px 17px;border:1px solid #d6b93d;background:#fff3c4;border-radius:12px;line-height:1.45}@media(max-width:720px){main{padding:18px}.top,.panel-head{display:block}.badge{display:inline-block;margin-top:14px}.compare{grid-template-columns:1fr}}</style></head><body><main><section class="top"><div><h1>dopa. format stretch test</h1><p>Links staat altijd het originele Pinterest-design van 1000×1500. Rechts staat hetzelfde ontwerp in het gekozen nieuwe formaat. Zo kun je compositie, tekst en logo rechtstreeks vergelijken voordat alle 36 ontwerpen worden uitgerold.</p></div><span class="badge">3 designs · 4 formaten · visuele proef</span></section><nav class="tabs">${tabs}</nav>${panels}<div class="note"><strong>Download volgt na goedkeuring.</strong> De definitieve PNG-export krijgt eerst exacte afmetingen, lokale fonts en automatische QA. YouTube-landscape vraagt een aparte brede compositie en is daarom nog niet stilletjes afgeleid van een verticale Pin.</div></main><script>const state=JSON.parse(localStorage.getItem('dopa-pinterest-stretch-proof')||'{}');for(const tab of document.querySelectorAll('[data-tab]'))tab.onclick=()=>{for(const item of document.querySelectorAll('[data-tab]'))item.setAttribute('aria-pressed',String(item===tab));for(const panel of document.querySelectorAll('[data-panel]'))panel.classList.toggle('active',panel.dataset.panel===tab.dataset.tab)};function render(){for(const card of document.querySelectorAll('[data-key]')){const choice=state[card.dataset.key]||'';card.dataset.state=choice;card.querySelector('.status').textContent=choice==='approved'?'goed':choice==='rejected'?'opnieuw':'te beoordelen'}}for(const card of document.querySelectorAll('[data-key]'))card.onclick=e=>{if(!e.target.dataset.choice)return;state[card.dataset.key]=e.target.dataset.choice;localStorage.setItem('dopa-pinterest-stretch-proof',JSON.stringify(state));render()};render()</script></body></html>`;
}

function card(profile, sample) {
  const key = `${profile.id}:${sample.slug}`;
  return `<article class="card" data-key="${key}"><header><div><span class="label">${escapeHtml(profile.name)}</span><h3>${escapeHtml(sample.label)}</h3></div><span class="status">te beoordelen</span></header><div class="compare"><figure><figcaption>Origineel · Pinterest · 1000×1500</figcaption><div class="frame" style="--ratio:1000/1500"><iframe loading="lazy" src="proofs/pinterest/${sample.slug}.html" title="Origineel Pinterest: ${escapeHtml(sample.label)}"></iframe></div></figure><figure><figcaption>Nieuw · ${escapeHtml(profile.name)} · ${profile.width}×${profile.height}</figcaption><div class="frame" style="--ratio:${profile.width}/${profile.height}"><iframe loading="lazy" src="proofs/${profile.id}/${sample.slug}.html" title="${escapeHtml(profile.name)}: ${escapeHtml(sample.label)}"></iframe></div></figure></div><div class="actions"><button type="button" data-choice="approved">goedkeuren</button><button type="button" data-choice="rejected">opnieuw</button></div></article>`;
}

function labelOf(section) { return section.match(/data-label="([^"]+)"/i)?.[1] ?? "untitled"; }
function slugify(value) { return value.normalize("NFKD").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase(); }
function escapeHtml(value) { return String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"); }
