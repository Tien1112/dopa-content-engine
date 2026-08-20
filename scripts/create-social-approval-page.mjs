import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? "work/dopa-approval");
const jobs = JSON.parse(await readFile(path.join(root, "render-pages", "render-jobs.json"), "utf8"));
const qa = JSON.parse(await readFile(path.join(root, "production", "social", "qa-report.json"), "utf8"));
if (qa.status !== "passed") throw new Error("Social output QA has not passed");
const designs = jobs.jobs.filter((job) => job.profile === "square-source").sort((a, b) => a.label.localeCompare(b.label));
const channels = [
  { id: "instagram-feed", name: "Instagram Post", size: "1080×1350", profile: "instagram-feed" },
  { id: "instagram-story", name: "Instagram Story / Reel", size: "1080×1920", profile: "story" },
  { id: "facebook-feed", name: "Facebook Feed", size: "1080×1350", profile: "instagram-feed" },
  { id: "facebook-story", name: "Facebook Story / Reel", size: "1080×1920", profile: "story" },
  { id: "pinterest", name: "Pinterest", size: "1000×1500", profile: "pinterest" },
  { id: "youtube-thumbnail", name: "YouTube Thumbnail", size: "3840×2160", profile: "youtube-thumbnail" },
  { id: "youtube-shorts", name: "YouTube Shorts", size: "1080×1920", profile: "story" }
];

const tabs = channels.map((channel, index) => `<button type="button" data-tab="${channel.id}" aria-pressed="${index === 0}">${escapeHtml(channel.name)}</button>`).join("");
const panels = channels.map((channel, index) => `<section class="panel${index === 0 ? " active" : ""}" data-panel="${channel.id}">
  <div class="channel-head"><div><span class="eyebrow">${escapeHtml(channel.name)}</span><h2>${channel.size}</h2></div><p>Links staat het vierkante Claude-brondesign; rechts de nieuwe ${escapeHtml(channel.name)}-compositie.</p></div>
  <div class="gallery">${designs.map((design) => card(channel, design)).join("")}</div>
</section>`).join("");

const html = `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dopa · social design approval</title><style>
:root{--cream:#faf4e8;--paper:#fffdf8;--ink:#1a1a1a;--muted:#6b6861;--line:#d9d3c8;--green:#2d6b52;--red:#a43434}*{box-sizing:border-box}body{margin:0;background:var(--cream);color:var(--ink);font-family:Arial,sans-serif}main{max-width:1500px;margin:auto;padding:28px}.top{display:flex;justify-content:space-between;gap:24px;border-bottom:2px solid var(--ink);padding-bottom:22px}.top h1{font-size:clamp(34px,5vw,66px);line-height:.95;letter-spacing:-.05em;margin:0}.top p{max-width:600px;color:var(--muted);line-height:1.5}.top-actions{display:flex;flex-direction:column;align-items:flex-end;gap:10px}.badge{white-space:nowrap;border:1px solid var(--green);color:var(--green);border-radius:999px;padding:9px 12px;font-weight:700;height:min-content}.test-download{white-space:nowrap;background:var(--ink)!important;color:white!important;border-color:var(--ink)!important}.tabs{display:flex;gap:8px;flex-wrap:wrap;margin:22px 0}.tabs button,.actions button,.download{border:1px solid var(--ink);background:var(--paper);color:var(--ink);border-radius:999px;padding:10px 13px;font-weight:700;cursor:pointer;text-decoration:none}.tabs button[aria-pressed=true]{background:var(--ink);color:white}.panel{display:none}.panel.active{display:block}.channel-head{display:flex;justify-content:space-between;align-items:end;gap:24px;margin:24px 0}.channel-head h2{font-size:34px;margin:3px 0 0}.channel-head p{color:var(--muted);max-width:520px}.eyebrow,.label{font:700 11px monospace;color:var(--muted);text-transform:uppercase}.gallery{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.card{background:var(--paper);border:1px solid var(--line);border-radius:14px;padding:16px}.card header{display:flex;justify-content:space-between;gap:14px;margin-bottom:12px}.card h3{font-size:18px;margin:3px 0 0}.status{font-size:12px;border:1px solid var(--line);border-radius:999px;padding:6px 9px;height:min-content}.card[data-state=approved] .status{border-color:var(--green);color:var(--green)}.card[data-state=rejected] .status{border-color:var(--red);color:var(--red)}.compare{display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:start}.compare figure{margin:0}.compare figcaption{font:700 10px monospace;color:var(--muted);margin-bottom:6px}.compare img{width:100%;height:auto;display:block;border:1px solid var(--line);border-radius:8px;background:var(--cream)}.actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:12px}.actions button[data-choice=approved]{border-color:var(--green)}.actions button[data-choice=rejected]{border-color:var(--red)}.card[data-state=approved] button[data-choice=approved]{background:var(--green);color:white}.card[data-state=rejected] button[data-choice=rejected]{background:var(--red);color:white}.download{margin-left:auto}.foot{border-top:1px solid var(--line);margin-top:28px;padding-top:18px;color:var(--muted)}@media(max-width:850px){main{padding:18px}.top,.channel-head{display:block}.top-actions{align-items:flex-start;margin-top:16px}.badge{display:inline-block}.gallery{grid-template-columns:1fr}.compare{gap:8px}.download{margin-left:0}}
</style></head><body><main>
<section class="top"><div><h1>dopa. social design approval</h1><p>Bekijk de echte composities per kanaal. Alle afbeeldingen zijn technisch op het juiste formaat; jij bepaalt hier of de layout visueel klopt.</p></div><div class="top-actions"><span class="badge">${qa.outputs.length} bestanden · technische QA groen</span><a class="download test-download" href="production/social/instagram-feed/01.png" download="dopa-test-instagram-post-01.png">test download PNG</a><button class="download" id="export-review" type="button">download mijn review</button></div></section>
<nav class="tabs" aria-label="Social kanalen">${tabs}<button type="button" data-tab="merchant" aria-pressed="false">Google Merchant</button></nav>
${panels}
<section class="panel" data-panel="merchant"><div class="channel-head"><div><span class="eyebrow">Google Merchant</span><h2>Aparte productbeelden</h2></div></div><div class="card"><p>Quote-designs zijn geen geldige hoofdproductfoto. Hier komen later de echte Shopify-, Printful- of Gelato-productbeelden van 1500×1500 of groter.</p></div></section>
<div class="foot">Privé en lokaal · beslissingen blijven in deze browser · individuele PNG-downloads zijn beschikbaar</div>
</main><script>
const state=JSON.parse(localStorage.getItem('dopa-social-approval-v1')||'{}');
for(const tab of document.querySelectorAll('[data-tab]'))tab.addEventListener('click',()=>{for(const t of document.querySelectorAll('[data-tab]'))t.setAttribute('aria-pressed',String(t===tab));for(const p of document.querySelectorAll('[data-panel]'))p.classList.toggle('active',p.dataset.panel===tab.dataset.tab);});
function render(){for(const card of document.querySelectorAll('.card[data-key]')){const item=state[card.dataset.key]||{};card.dataset.state=item.choice||'';card.querySelector('.status').textContent=item.choice==='approved'?'goedgekeurd':item.choice==='rejected'?'opnieuw':'te beoordelen';}localStorage.setItem('dopa-social-approval-v1',JSON.stringify(state));}
for(const card of document.querySelectorAll('.card[data-key]'))card.addEventListener('click',event=>{const choice=event.target.dataset.choice;if(!choice)return;state[card.dataset.key]={choice};render();});
document.getElementById('export-review').addEventListener('click',()=>{const blob=new Blob([JSON.stringify({created_at:new Date().toISOString(),reviewer:'Margot',decisions:state},null,2)],{type:'application/json'});const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='dopa-margot-review.json';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);});render();
</script></body></html>`;
await writeFile(path.join(root, "index.html"), html);
console.log(JSON.stringify({ page: path.join(root, "index.html"), channels: channels.length, designs: designs.length, qa: qa.status }, null, 2));

function card(channel, design) {
  const output = `production/social/${channel.profile}/${design.label}.png`;
  const source = `production/social/square-source/${design.label}.png`;
  const key = `${channel.id}:${design.label}`;
  return `<article class="card" data-key="${key}"><header><div><span class="label">design ${design.label}</span><h3>${escapeHtml(design.title)}</h3></div><span class="status">te beoordelen</span></header><div class="compare"><figure><figcaption>Claude-bron · 1080×1080</figcaption><img loading="lazy" src="${source}" alt="Vierkante bron ${escapeHtml(design.title)}"></figure><figure><figcaption>${escapeHtml(channel.name)} · ${channel.size}</figcaption><img loading="lazy" src="${output}" alt="${escapeHtml(channel.name)} ${escapeHtml(design.title)}"></figure></div><div class="actions"><button type="button" data-choice="approved">goedkeuren</button><button type="button" data-choice="rejected">opnieuw</button><a class="download" href="${output}" download="dopa-${channel.id}-${design.label}.png">download PNG</a></div></article>`;
}
function escapeHtml(value){return String(value).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;')}
