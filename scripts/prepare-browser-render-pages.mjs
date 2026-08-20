import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const sourceFile = path.resolve(process.argv[2] ?? "work/dopa-approval/prepared/square-source/source/index.html");
const outputRoot = path.resolve(process.argv[3] ?? "work/dopa-approval/render-pages");
const wrapper = await readFile(sourceFile, "utf8");
const templateMatch = wrapper.match(/(<script type="__bundler\/template">\s*)([\s\S]*?)(\s*<\/script>)/);
if (!templateMatch) throw new Error("Bundled Claude template was not found");
const innerHtml = JSON.parse(templateMatch[2].trim());
const sections = innerHtml.match(/<section data-document-role="page"[\s\S]*?<\/section>/g) ?? [];
if (sections.length !== 28) throw new Error(`Expected 28 Claude design sections, found ${sections.length}`);

const profiles = [
  { id: "square-source", logicalWidth: 1080, logicalHeight: 1080, width: 1080, height: 1080 },
  { id: "instagram-feed", logicalWidth: 1080, logicalHeight: 1350, width: 1080, height: 1350 },
  { id: "story", logicalWidth: 1080, logicalHeight: 1920, width: 1080, height: 1920 },
  { id: "pinterest", logicalWidth: 1080, logicalHeight: 1620, width: 1000, height: 1500 },
  { id: "youtube-thumbnail", logicalWidth: 1920, logicalHeight: 1080, width: 3840, height: 2160 }
];
const records = [];
for (const profile of profiles) {
  const profileRoot = path.join(outputRoot, profile.id);
  await mkdir(profileRoot, { recursive: true });
  for (const [index, originalSection] of sections.entries()) {
    const label = originalSection.match(/data-label="([^"]+)"/)?.[1] ?? String(index + 1).padStart(2, "0");
    const safeLabel = label.replace(/[^A-Za-z0-9_-]+/g, "-").toLowerCase();
    const title = sectionTitle(originalSection) || `Design ${label}`;
    const section = adaptSection(originalSection, profile.logicalWidth, profile.logicalHeight);
    const isolatedHtml = isolate(innerHtml, section, profile.logicalWidth, profile.logicalHeight);
    const outputWrapper = wrapper.replace(templateMatch[0], `${templateMatch[1]}${JSON.stringify(isolatedHtml)}${templateMatch[3]}`);
    const filename = `${safeLabel}.html`;
    await writeFile(path.join(profileRoot, filename), outputWrapper);
    records.push({ profile: profile.id, label: safeLabel, title, html: `render-pages/${profile.id}/${filename}`, logicalWidth: profile.logicalWidth, logicalHeight: profile.logicalHeight, width: profile.width, height: profile.height });
  }
}
await writeFile(path.join(outputRoot, "render-jobs.json"), `${JSON.stringify({ source: sourceFile, profiles, jobs: records }, null, 2)}\n`);
console.log(JSON.stringify({ output: outputRoot, profiles: profiles.length, jobs: records.length }, null, 2));

function isolate(html, section, width, height) {
  const headStyle = `<style id="dopa-render-isolation">html,body{margin:0!important;padding:0!important;width:${width}px!important;min-width:${width}px!important;height:${height}px!important;min-height:${height}px!important;overflow:hidden!important;background:#FAF4E8!important}body{display:block!important}.dopa-capture{width:${width}px;height:${height}px;overflow:hidden}.dopa-capture>section{margin:0!important}</style>`;
  return html
    .replace("</head>", `${headStyle}</head>`)
    .replace(/<body[^>]*>[\s\S]*<\/body>/, `<body><div class="dopa-capture">${section}</div></body>`);
}

function adaptSection(section, width, height) {
  const deltaX = width - 1080;
  const deltaY = height - 1080;
  let adapted = section.replace(/(<section data-document-role="page"[^>]*style=")([^"]*)(")/, (_match, start, style, end) => {
    const next = style.replace(/width:\s*1080px/, `width:${width}px`).replace(/height:\s*1080px/, `height:${height}px`);
    return `${start}${next}${end}`;
  });
  if (deltaY) adapted = adapted.replace(/top:\s*(\d+)px/g, (match, raw) => Number(raw) > 540 ? `top:${Number(raw) + deltaY}px` : match);
  if (deltaX) adapted = adapted.replace(/left:\s*(\d+)px/g, (match, raw) => Number(raw) > 540 ? `left:${Number(raw) + deltaX}px` : match);
  return adapted;
}

function sectionTitle(section) {
  const strongs = [...section.matchAll(/<strong[^>]*>([\s\S]*?)<\/strong>/g)]
    .map((match) => match[1].replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
    .filter((text) => text && text.toLowerCase() !== "dopa");
  return strongs.join(" ").replace(/\s+/g, " ").trim();
}
