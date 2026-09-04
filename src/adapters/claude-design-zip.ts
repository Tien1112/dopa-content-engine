import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const MAX_ARCHIVE_ENTRIES = 500;
const MAX_ENTRY_BYTES = 32 * 1024 * 1024;

export interface PreparedClaudeJobs {
  archive: string;
  square: { manifest: string; pages: number; canvas: { width: number; height: number } };
  pinterest?: { manifest: string; pages: number; source_dimensions: { width: number; height: number } };
  variants: Array<{ preset: string; manifest: string; pages: number; canvas: { width: number; height: number } }>;
  missing_approved_compositions: string[];
}

export interface PreparedHtmlJob {
  manifest: string;
  pages: number;
  canvas: { width: number; height: number };
  preset: string;
}

function unzip(args: string[], binary = false): Promise<string | Buffer> {
  return new Promise((resolve, reject) => {
    execFile("unzip", args, { encoding: binary ? "buffer" : "utf8", maxBuffer: MAX_ENTRY_BYTES }, (error, stdout, stderr) => {
      if (error) reject(new Error(`unzip failed: ${String(stderr || error.message).trim()}`));
      else resolve(stdout);
    });
  });
}

export function validateZipEntries(entries: string[]): void {
  if (entries.length === 0) throw new Error("Claude Design ZIP is empty");
  if (entries.length > MAX_ARCHIVE_ENTRIES) throw new Error(`Claude Design ZIP contains ${entries.length} entries; maximum is ${MAX_ARCHIVE_ENTRIES}`);
  for (const entry of entries) {
    if (!entry || entry.includes("\0") || entry.includes("\\") || path.posix.isAbsolute(entry) || entry.split("/").includes("..")) throw new Error(`Unsafe ZIP entry: ${entry}`);
  }
}

export function detectHtmlPages(html: string): { count: number; width: number; height: number } {
  const marker = /data-document-role=\\?"page\\?"/g;
  const count = [...html.matchAll(marker)].length;
  if (count === 0) throw new Error("Claude export contains no data-document-role=page canvases");
  const dimensions = [...html.matchAll(/data-document-role=\\?"page\\?"[^>]*?width:\s*(\d+)px;\s*height:\s*(\d+)px/gs)].map((match) => ({ width: Number(match[1]), height: Number(match[2]) }));
  if (dimensions.length !== count) throw new Error(`Could not determine dimensions for all ${count} Claude canvases`);
  const first = dimensions[0]!;
  if (dimensions.some((item) => item.width !== first.width || item.height !== first.height)) throw new Error("Claude export mixes canvas dimensions in one document");
  return { count, ...first };
}

export function readPngDimensions(buffer: Buffer): { width: number; height: number; alpha: boolean } {
  if (buffer.length < 26 || !buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error("Entry is not a valid PNG");
  const colorType = buffer[25]!;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), alpha: colorType === 4 || colorType === 6 };
}

export function detectFontFamilies(html: string): string[] {
  return [...new Set([...html.matchAll(/@font-face\s*\{[^}]*?font-family\s*:\s*\\?["']([^"';\\]+)/gs)].map((match) => match[1]!.trim()).filter(Boolean))].sort();
}

/**
 * Only require packaged fonts that are actually selected by visible content.
 * Claude bundles can include unused @font-face declarations; requiring every
 * declaration makes document.fonts.check fail for fonts the browser correctly
 * never downloads. Used fonts remain strict QA requirements.
 */
export function detectRequiredFontFamilies(html: string): string[] {
  const packaged = new Set(detectFontFamilies(html));
  const contentCss = html.replace(/@font-face\s*\{[^}]*\}/gis, "");
  const used = [...contentCss.matchAll(/font-family\s*:\s*\\?["']?([^;"'\\}]+)/gi)]
    .flatMap((match) => (match[1] ?? "").split(","))
    .map((family) => family.trim())
    .filter(Boolean);
  return [...new Set(used.filter((family) => packaged.has(family)))].sort();
}

export function isTwoByThree(width: number, height: number): boolean {
  return width > 0 && height > 0 && width * 3 === height * 2;
}

export function exactPresetForCanvas(width: number, height: number): string {
  const key = `${width}x${height}`;
  const presets: Record<string, string> = {
    "1080x1080": "instagram_square",
    "1080x1350": "instagram_feed",
    "1080x1920": "instagram_story",
    "1000x1500": "pinterest_standard"
  };
  const preset = presets[key];
  if (!preset) throw new Error(`No approved exact output preset exists for canvas ${key}`);
  return preset;
}

export const CLAUDE_SOCIAL_PROFILES = [
  { preset: "instagram_square", logicalWidth: 1080, logicalHeight: 1080, width: 1080, height: 1080 },
  { preset: "instagram_feed", logicalWidth: 1080, logicalHeight: 1350, width: 1080, height: 1350 },
  { preset: "instagram_story", logicalWidth: 1080, logicalHeight: 1920, width: 1080, height: 1920 },
  { preset: "instagram_reel", logicalWidth: 1080, logicalHeight: 1920, width: 1080, height: 1920 },
  { preset: "facebook_feed", logicalWidth: 1080, logicalHeight: 1350, width: 1080, height: 1350 },
  { preset: "facebook_landscape", logicalWidth: 1200, logicalHeight: 630, width: 1200, height: 630 },
  { preset: "facebook_story", logicalWidth: 1080, logicalHeight: 1920, width: 1080, height: 1920 },
  { preset: "facebook_reel", logicalWidth: 1080, logicalHeight: 1920, width: 1080, height: 1920 },
  { preset: "pinterest_standard", logicalWidth: 1080, logicalHeight: 1620, width: 1000, height: 1500 },
  { preset: "etsy_listing_landscape", logicalWidth: 1440.18, logicalHeight: 1080, width: 2667, height: 2000 },
  { preset: "etsy_listing_square", logicalWidth: 1080, logicalHeight: 1080, width: 2000, height: 2000 }
] as const;

type ClaudeSocialProfile = typeof CLAUDE_SOCIAL_PROFILES[number];

export function selectClaudeSocialProfiles(requestedPresets?: readonly string[]): ClaudeSocialProfile[] {
  const requested = new Set(requestedPresets ?? CLAUDE_SOCIAL_PROFILES.map((profile) => profile.preset));
  const unknown = [...requested].filter((key) => !CLAUDE_SOCIAL_PROFILES.some((profile) => profile.preset === key));
  if (unknown.length) throw new Error(`Unsupported requested preset(s): ${unknown.join(", ")}`);
  const selected = CLAUDE_SOCIAL_PROFILES.filter((profile) => requested.has(profile.preset));
  if (!selected.length) throw new Error("At least one supported output preset is required");
  return selected;
}

/**
 * Reflow the approved square Claude pages into a channel canvas without
 * stretching their contents. Elements anchored in the lower/right half move
 * with the corresponding edge; typography and decorative geometry stay at
 * their authored proportions. Pinterest and the wide profile are rendered at
 * a proportional scale so the final bitmap remains crisp at its exact preset.
 */
export function adaptBundledClaudeHtml(html: string, profile: ClaudeSocialProfile): string {
  const templateMatch = html.match(/(<script type="__bundler\/template">\s*)([\s\S]*?)(\s*<\/script>)/);
  if (!templateMatch) return adaptClaudePages(html, profile);
  let innerHtml: string;
  try {
    innerHtml = JSON.parse(templateMatch[2]!.trim()) as string;
  } catch {
    throw new Error("Bundled Claude template contains invalid JSON");
  }
  const adapted = adaptClaudePages(innerHtml, profile);
  return html.replace(templateMatch[0], `${templateMatch[1]}${JSON.stringify(adapted)}${templateMatch[3]}`);
}

function adaptClaudePages(html: string, profile: ClaudeSocialProfile): string {
  let pageCount = 0;
  const adapted = html.replace(/<section data-document-role="page"[\s\S]*?<\/section>/g, (section) => {
    pageCount += 1;
    return adaptClaudeSection(section, profile);
  });
  if (pageCount === 0) throw new Error("Claude export contains no renderable pages");
  return adapted;
}

function adaptClaudeSection(section: string, profile: ClaudeSocialProfile): string {
  const deltaX = profile.logicalWidth - 1080;
  const deltaY = profile.logicalHeight - 1080;
  const scaleX = profile.width / profile.logicalWidth;
  const scaleY = profile.height / profile.logicalHeight;
  if (Math.abs(scaleX - scaleY) > 0.001) throw new Error(`Profile ${profile.preset} would stretch the design`);
  let adapted = section.replace(/(<section data-document-role="page"[^>]*style=")([^"]*)(")/, (_match, start, style, end) => {
    let next = String(style)
      .replace(/width:\s*1080px/, `width:${profile.logicalWidth}px`)
      .replace(/height:\s*1080px/, `height:${profile.logicalHeight}px`);
    if (!/width:\s*\d+(?:\.\d+)?px/.test(next) || !/height:\s*\d+(?:\.\d+)?px/.test(next)) throw new Error("Claude page has no explicit pixel dimensions");
    if (scaleX !== 1) next += `;zoom:${scaleX}`;
    return `${start}${next}${end}`;
  });
  if (deltaY) adapted = adapted.replace(/top:\s*(\d+)px/g, (match, raw) => Number(raw) > 540 ? `top:${Number(raw) + deltaY}px` : match);
  if (deltaX) adapted = adapted.replace(/left:\s*(\d+)px/g, (match, raw) => Number(raw) > 540 ? `left:${Number(raw) + deltaX}px` : match);
  return adapted;
}

export async function prepareClaudeDesignHtml(html: string, outputInput: string, brand = "imported-design"): Promise<PreparedHtmlJob> {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(brand)) throw new Error("brand must be a lowercase slug");
  const outputRoot = path.resolve(outputInput);
  const canvas = detectHtmlPages(html);
  const preset = exactPresetForCanvas(canvas.width, canvas.height);
  const requiredFonts = detectRequiredFontFamilies(html);
  await mkdir(path.join(outputRoot, "source"), { recursive: true });
  await writeFile(path.join(outputRoot, "source", "index.html"), html);
  const manifest = {
    schema_version: 1,
    content_id: `${brand}-claude-${preset}-approved`,
    brand,
    version: 1,
    source: "source/index.html",
    canvas: { width: canvas.width, height: canvas.height },
    pages: { selector: "[data-document-role=page]", label_attribute: "data-label", maximum: canvas.count },
    animation: false,
    transparent_background: false,
    ...(requiredFonts.length ? { required_fonts: requiredFonts } : {}),
    outputs: [{ preset, mode: "exact" }]
  };
  const manifestPath = path.join(outputRoot, "manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifest: manifestPath, pages: canvas.count, canvas: { width: canvas.width, height: canvas.height }, preset };
}

async function prepareSocialVariants(
  html: string,
  outputInput: string,
  brand: string,
  requestedPresets?: readonly string[]
): Promise<{ variants: PreparedClaudeJobs["variants"]; pages: number; sourceCanvas: { width: number; height: number } }> {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(brand)) throw new Error("brand must be a lowercase slug");
  const outputRoot = path.resolve(outputInput);
  const canvas = detectHtmlPages(html);
  if (canvas.width !== 1080 || canvas.height !== 1080) throw new Error(`Multi-format Claude production requires an approved 1080x1080 source canvas, got ${canvas.width}x${canvas.height}`);
  const requiredFonts = detectRequiredFontFamilies(html);
  const variants: PreparedClaudeJobs["variants"] = [];
  for (const profile of selectClaudeSocialProfiles(requestedPresets)) {
    const variantRoot = path.join(outputRoot, `${profile.preset}-source`);
    await mkdir(path.join(variantRoot, "source"), { recursive: true });
    const variantHtml = profile.logicalWidth === 1080 && profile.logicalHeight === 1080 && profile.width === 1080
      ? html
      : adaptBundledClaudeHtml(html, profile);
    await writeFile(path.join(variantRoot, "source", "index.html"), variantHtml);
    const manifest = {
      schema_version: 1,
      content_id: `${brand}-claude-${profile.preset}-approved`,
      brand,
      version: 1,
      source: "source/index.html",
      canvas: { width: profile.width, height: profile.height },
      pages: { selector: "[data-document-role=page]", label_attribute: "data-label", maximum: canvas.count },
      animation: false,
      transparent_background: false,
      ...(requiredFonts.length ? { required_fonts: requiredFonts } : {}),
      outputs: [{ preset: profile.preset, mode: "exact", ...((profile.preset.endsWith("_reel")) ? { duration_seconds: 5, frame_rate: 30 } : {}) }]
    };
    const manifestPath = path.join(variantRoot, "manifest.json");
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    variants.push({ preset: profile.preset, manifest: manifestPath, pages: canvas.count, canvas: { width: profile.width, height: profile.height } });
  }
  return { variants, pages: canvas.count, sourceCanvas: { width: canvas.width, height: canvas.height } };
}

export async function prepareClaudeDesignHtmlVariants(
  html: string,
  outputInput: string,
  brand = "imported-design",
  requestedPresets?: readonly string[]
): Promise<PreparedClaudeJobs> {
  const prepared = await prepareSocialVariants(html, outputInput, brand, requestedPresets);
  const square = prepared.variants.find((variant) => variant.preset === "instagram_square") ?? prepared.variants[0]!;
  const pinterest = prepared.variants.find((variant) => variant.preset === "pinterest_standard");
  return {
    archive: "",
    square: { manifest: square.manifest, pages: square.pages, canvas: square.canvas },
    ...(pinterest ? { pinterest: { manifest: pinterest.manifest, pages: pinterest.pages, source_dimensions: prepared.sourceCanvas } } : {}),
    variants: prepared.variants,
    missing_approved_compositions: []
  };
}

/**
 * Prepare one flat square PNG for every requested social preset.
 *
 * A PNG has no editable text or layer positions, so it cannot be semantically
 * reflowed like a Claude HTML export. The approved source therefore stays
 * completely visible and proportional. Empty canvas space is filled with a
 * soft, cropped copy of the same artwork; the foreground is never stretched or
 * cropped. This is deterministic and intentionally not generative.
 */
export async function prepareClaudeDesignPngVariants(
  png: Buffer,
  outputInput: string,
  brand = "imported-design",
  requestedPresets?: readonly string[]
): Promise<PreparedClaudeJobs> {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(brand)) throw new Error("brand must be a lowercase slug");
  const dimensions = readPngDimensions(png);
  if (dimensions.width !== dimensions.height) {
    throw new Error(`Flat PNG production requires a square source, got ${dimensions.width}x${dimensions.height}`);
  }
  if (dimensions.width < 512 || dimensions.width > 4096) {
    throw new Error(`Square PNG side must be between 512 and 4096 pixels, got ${dimensions.width}`);
  }

  const outputRoot = path.resolve(outputInput);
  const variants: PreparedClaudeJobs["variants"] = [];
  for (const profile of selectClaudeSocialProfiles(requestedPresets)) {
    const variantRoot = path.join(outputRoot, `${profile.preset}-source`);
    const sourceRoot = path.join(variantRoot, "source");
    await mkdir(sourceRoot, { recursive: true });
    await writeFile(path.join(sourceRoot, "source.png"), png);
    const html = flatPngHtml(profile.width, profile.height);
    await writeFile(path.join(sourceRoot, "index.html"), html);
    const manifest = {
      schema_version: 1,
      content_id: `${brand}-png-${profile.preset}-approved`,
      brand,
      version: 1,
      source: "source/index.html",
      canvas: { width: profile.width, height: profile.height },
      pages: { selector: "[data-document-role=page]", label_attribute: "data-label", maximum: 1 },
      animation: false,
      transparent_background: false,
      outputs: [{
        preset: profile.preset,
        mode: "exact",
        ...(profile.preset.endsWith("_reel") ? { duration_seconds: 5, frame_rate: 30 } : {})
      }]
    };
    const manifestPath = path.join(variantRoot, "manifest.json");
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    variants.push({ preset: profile.preset, manifest: manifestPath, pages: 1, canvas: { width: profile.width, height: profile.height } });
  }
  const square = variants.find((variant) => variant.preset === "instagram_square") ?? variants[0]!;
  const pinterest = variants.find((variant) => variant.preset === "pinterest_standard");
  return {
    archive: "",
    square: { manifest: square.manifest, pages: 1, canvas: square.canvas },
    ...(pinterest ? { pinterest: { manifest: pinterest.manifest, pages: 1, source_dimensions: dimensions } } : {}),
    variants,
    missing_approved_compositions: []
  };
}

function flatPngHtml(width: number, height: number): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#fff}
[data-document-role=page]{position:relative;width:${width}px;height:${height}px;overflow:hidden;background:#fff}
.background{position:absolute;inset:-7%;width:114%;height:114%;object-fit:cover;filter:blur(72px);opacity:.42}
.foreground{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}
</style></head><body><section data-document-role="page" data-label="01">
<img class="background" src="source.png" alt="" aria-hidden="true">
<img class="foreground" src="source.png" alt="Approved source design">
</section></body></html>`;
}

export async function prepareClaudeDesignZip(zipInput: string, outputInput: string, brand = "imported-design", requestedPresets?: readonly string[]): Promise<PreparedClaudeJobs> {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(brand)) throw new Error("brand must be a lowercase slug");
  const zipPath = path.resolve(zipInput);
  const outputRoot = path.resolve(outputInput);
  const listing = String(await unzip(["-Z1", zipPath]));
  const entries = listing.split(/\r?\n/).filter(Boolean);
  validateZipEntries(entries);

  const bundledCandidates = entries.filter((entry) => /(?:^|\/)[^/]+-export-bundled\.html$/i.test(entry));
  if (bundledCandidates.length !== 1) throw new Error(`Expected exactly one bundled Claude HTML export, found ${bundledCandidates.length}`);
  const html = String(await unzip(["-p", zipPath, bundledCandidates[0]!]));
  const prepared = await prepareSocialVariants(html, outputRoot, brand, requestedPresets);
  const square = prepared.variants.find((variant) => variant.preset === "instagram_square") ?? prepared.variants[0]!;
  const pinterestVariant = prepared.variants.find((variant) => variant.preset === "pinterest_standard");

  return {
    archive: zipPath,
    square: { manifest: square.manifest, pages: square.pages, canvas: square.canvas },
    ...(pinterestVariant ? { pinterest: { manifest: pinterestVariant.manifest, pages: pinterestVariant.pages, source_dimensions: prepared.sourceCanvas } } : {}),
    variants: prepared.variants,
    missing_approved_compositions: []
  };
}
