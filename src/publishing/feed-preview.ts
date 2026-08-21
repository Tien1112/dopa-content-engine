import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ContentPlan, ContentPlanItem } from "./types.js";

export interface SocialPreviewResult {
  plan_id: string;
  revision: number;
  preview_file: string;
  instagram_items: number;
  facebook_items: number;
  note: string;
}

export function applyInstagramGridOrder(plan: ContentPlan, newestFirstItemIds: readonly string[]): ContentPlan {
  if (plan.status !== "draft") throw new Error("Only a draft plan can be reordered");
  const gridItems = instagramGridItems(plan);
  const expected = new Set(gridItems.map((item) => item.item_id));
  if (newestFirstItemIds.length !== expected.size || new Set(newestFirstItemIds).size !== expected.size) {
    throw new Error("Instagram order must contain every planned grid item exactly once");
  }
  for (const itemId of newestFirstItemIds) if (!expected.has(itemId)) throw new Error(`Unknown Instagram grid item: ${itemId}`);

  const ascendingTimes = gridItems.map((item) => item.publish_at).sort((left, right) => Date.parse(left) - Date.parse(right));
  const timeByItem = new Map<string, string>();
  [...newestFirstItemIds].reverse().forEach((itemId, index) => timeByItem.set(itemId, ascendingTimes[index]!));
  const { approval: _approval, ...draft } = plan;
  return {
    ...draft,
    revision: plan.revision + 1,
    status: "draft",
    items: plan.items.map((item) => timeByItem.has(item.item_id) ? { ...item, publish_at: timeByItem.get(item.item_id)! } : item)
  };
}

export async function createSocialPreview(plan: ContentPlan, outputRoot: string, mediaRoot: string): Promise<SocialPreviewResult> {
  const previewRoot = path.resolve(outputRoot, `${plan.plan_id}-r${plan.revision}`);
  const assetsRoot = path.join(previewRoot, "assets");
  await mkdir(assetsRoot, { recursive: true });
  const media = new Map<string, string>();
  for (const item of plan.items) {
    const asset = item.media[0];
    if (!asset) continue;
    const source = safeMediaPath(mediaRoot, asset.file);
    const extension = path.extname(source).toLowerCase() || extensionForMime(asset.mime_type);
    const targetName = `${safeName(item.item_id)}${extension}`;
    try {
      await copyFile(source, path.join(assetsRoot, targetName));
      media.set(item.item_id, `assets/${targetName}`);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw error;
    }
  }

  const instagram = instagramGridItems(plan).sort(newestFirst);
  const facebook = plan.items.filter((item) => item.channel === "facebook").sort(oldestFirst);
  const previewFile = path.join(previewRoot, "index.html");
  await writeFile(previewFile, html(plan, instagram, facebook, media), "utf8");
  return {
    plan_id: plan.plan_id,
    revision: plan.revision,
    preview_file: previewFile,
    instagram_items: instagram.length,
    facebook_items: facebook.length,
    note: "This preview shows planned posts only. Existing live feed posts appear after the Meta read connection is configured."
  };
}

function instagramGridItems(plan: ContentPlan): ContentPlanItem[] {
  return plan.items.filter((item) => item.channel === "instagram" && ["feed_post", "carousel", "reel"].includes(item.content_type));
}

function safeMediaPath(mediaRoot: string, file: string): string {
  const root = path.resolve(mediaRoot);
  const candidate = path.resolve(root, file);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) throw new Error(`Media file escapes DOPA_MEDIA_ROOT: ${file}`);
  return candidate;
}

function safeName(value: string): string { return value.replace(/[^a-zA-Z0-9_-]/g, "-"); }
function extensionForMime(mime: string): string { return mime === "video/mp4" ? ".mp4" : mime === "video/webm" ? ".webm" : mime === "image/jpeg" ? ".jpg" : ".png"; }
function newestFirst(left: ContentPlanItem, right: ContentPlanItem): number { return Date.parse(right.publish_at) - Date.parse(left.publish_at); }
function oldestFirst(left: ContentPlanItem, right: ContentPlanItem): number { return Date.parse(left.publish_at) - Date.parse(right.publish_at); }
function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!); }

function mediaElement(item: ContentPlanItem, media: Map<string, string>): string {
  const source = media.get(item.item_id);
  if (!source) return `<div class="missing">Bestand niet gevonden<br><small>${escapeHtml(item.media[0]?.file ?? "geen bestand")}</small></div>`;
  const asset = item.media[0]!;
  if (asset.mime_type.startsWith("video/")) return `<video src="${escapeHtml(source)}" muted loop playsinline controls></video>`;
  return `<img src="${escapeHtml(source)}" alt="${escapeHtml(item.copy.alt_text ?? item.copy.message)}">`;
}

function html(plan: ContentPlan, instagram: ContentPlanItem[], facebook: ContentPlanItem[], media: Map<string, string>): string {
  const igCards = instagram.map((item) => `<article class="ig-card" draggable="true" data-item-id="${escapeHtml(item.item_id)}">
    ${mediaElement(item, media)}
    <div class="badge">${escapeHtml(item.content_type)}</div><div class="handle" title="Sleep om te verplaatsen">⠿</div>
    <div class="card-info"><strong>${escapeHtml(item.item_id)}</strong><span>${escapeHtml(formatDate(item.publish_at))}</span></div>
  </article>`).join("\n");
  const fbCards = facebook.map((item) => `<article class="fb-card"><header><span class="avatar">d</span><div><strong>Dopa</strong><small>${escapeHtml(formatDate(item.publish_at))}</small></div></header>${mediaElement(item, media)}<p>${escapeHtml(item.copy.message)}</p><div class="tags">${escapeHtml((item.copy.hashtags ?? []).map((tag) => `#${tag.replace(/^#/, "")}`).join(" "))}</div></article>`).join("\n");
  return `<!doctype html>
<html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dopa social preview</title>
<style>
:root{--cream:#f5efe3;--ink:#171717;--pink:#f43f93;--muted:#746f67}*{box-sizing:border-box}body{margin:0;background:#e8e4dc;color:var(--ink);font-family:Arial,sans-serif}main{max-width:1180px;margin:auto;padding:40px 20px 80px}.top{display:flex;justify-content:space-between;gap:24px;align-items:end;margin-bottom:32px}.eyebrow{font:700 12px/1 monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--pink)}h1{font-size:clamp(34px,6vw,72px);line-height:.92;margin:10px 0}.meta{color:var(--muted)}button{border:0;border-radius:999px;padding:12px 18px;background:var(--ink);color:white;font-weight:700;cursor:pointer}button.secondary{background:white;color:var(--ink)}.notice{padding:14px 18px;border:1px solid #cbc5bb;background:#fff9;border-radius:14px;margin:18px 0 30px}.tabs{display:flex;gap:8px;margin:20px 0}.tab-panel[hidden]{display:none}.ig-shell{max-width:720px;background:white;padding:12px;border-radius:20px;box-shadow:0 10px 40px #0001}.ig-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:3px}.ig-card{aspect-ratio:1;position:relative;background:var(--cream);overflow:hidden;cursor:grab}.ig-card.dragging{opacity:.35}.ig-card img,.ig-card video{width:100%;height:100%;object-fit:cover}.badge,.handle{position:absolute;top:8px;background:#111d;color:white;border-radius:999px;font-size:10px;padding:5px 8px}.badge{left:8px}.handle{right:8px;font-size:16px}.card-info{position:absolute;inset:auto 0 0;background:linear-gradient(transparent,#000b);color:white;padding:28px 8px 8px;display:flex;flex-direction:column;font-size:10px}.missing{height:100%;display:grid;place-content:center;text-align:center;padding:8px;color:#8f302f}.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}.help{max-width:720px;color:var(--muted);font-size:14px}.fb-list{max-width:620px;display:grid;gap:20px}.fb-card{background:white;border-radius:16px;padding:14px;box-shadow:0 6px 24px #0001}.fb-card header{display:flex;gap:10px;align-items:center}.avatar{width:38px;height:38px;border-radius:50%;display:grid;place-content:center;background:var(--pink);color:white;font-weight:900}.fb-card small{display:block;color:var(--muted);margin-top:3px}.fb-card img,.fb-card video{display:block;width:calc(100% + 28px);margin:14px -14px 0;max-height:620px;object-fit:cover}.tags{color:#375899}.empty{padding:50px;background:#fff7;border:1px dashed #aaa;border-radius:16px;text-align:center;color:var(--muted)}@media(max-width:700px){.top{display:block}.top .actions{margin-top:20px}}
</style></head><body><main>
<div class="top"><div><div class="eyebrow">Dopa social planner</div><h1>Zie vóór je post.</h1><div class="meta">${escapeHtml(plan.plan_id)} · revisie ${plan.revision} · ${escapeHtml(plan.timezone)}</div></div><div class="actions"><button id="download">Download volgorde</button><button class="secondary" id="copy">Kopieer voor Claude</button></div></div>
<div class="notice"><strong>Let op:</strong> dit toont nu alleen de geplande posts. Bestaande live posts worden toegevoegd zodra de Meta-leeskoppeling actief is.</div>
<div class="tabs"><button data-tab="instagram">Instagram feed</button><button class="secondary" data-tab="facebook">Facebook tijdlijn</button></div>
<section id="instagram" class="tab-panel"><div class="ig-shell"><div class="ig-grid" id="grid">${igCards || '<div class="empty" style="grid-column:1/-1">Nog geen Instagram feedposts in dit plan.</div>'}</div></div><p class="help">Sleep de tegels naar de gewenste eindstand. Linksboven is de nieuwste post. De tool rekent dit om naar de omgekeerde volgorde waarin Instagram moet publiceren.</p></section>
<section id="facebook" class="tab-panel" hidden><div class="fb-list">${fbCards || '<div class="empty">Nog geen Facebook-posts in dit plan.</div>'}</div><p class="help">Facebook heeft geen vast profielraster. Daarom zie je hier de geplande tijdlijn in publicatievolgorde.</p></section>
</main><script>
const grid=document.querySelector('#grid');let dragged;
grid?.addEventListener('dragstart',e=>{dragged=e.target.closest('.ig-card');dragged?.classList.add('dragging')});
grid?.addEventListener('dragend',()=>dragged?.classList.remove('dragging'));
grid?.addEventListener('dragover',e=>{e.preventDefault();const target=e.target.closest('.ig-card');if(target&&dragged&&target!==dragged){const box=target.getBoundingClientRect();const before=e.clientY<box.top+box.height/2||(Math.abs(e.clientY-(box.top+box.height/2))<box.height*.25&&e.clientX<box.left+box.width/2);grid.insertBefore(dragged,before?target:target.nextSibling)}});
const payload=()=>({plan_id:${JSON.stringify(plan.plan_id)},expected_revision:${plan.revision},newest_first_item_ids:[...document.querySelectorAll('.ig-card')].map(el=>el.dataset.itemId)});
document.querySelector('#download').onclick=()=>{const blob=new Blob([JSON.stringify(payload(),null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=${JSON.stringify(`${plan.plan_id}-instagram-order.json`)};a.click();URL.revokeObjectURL(a.href)};
document.querySelector('#copy').onclick=async()=>{const text='Pas deze Instagram-feedvolgorde toe op plan '+${JSON.stringify(plan.plan_id)}+' revisie '+${plan.revision}+': '+payload().newest_first_item_ids.join(', ')+'. Maak daarna een nieuwe preview en vraag opnieuw om mijn goedkeuring.';try{await navigator.clipboard.writeText(text)}catch{const field=document.createElement('textarea');field.value=text;document.body.appendChild(field);field.select();document.execCommand('copy');field.remove()}document.querySelector('#copy').textContent='Gekopieerd ✓'};
document.querySelectorAll('[data-tab]').forEach(button=>button.onclick=()=>{document.querySelectorAll('.tab-panel').forEach(p=>p.hidden=p.id!==button.dataset.tab);document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('secondary',b!==button))});
</script></body></html>`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("nl-NL", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
