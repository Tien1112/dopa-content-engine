import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { adaptBundledClaudeHtml, CLAUDE_SOCIAL_PROFILES, detectFontFamilies, detectHtmlPages, detectRequiredFontFamilies, exactPresetForCanvas, isTwoByThree, prepareClaudeDesignPngVariants, readPngDimensions, selectClaudeSocialProfiles, validateZipEntries } from "../src/adapters/claude-design-zip.js";

test("rejects ZIP path traversal before extraction", () => {
  assert.throws(() => validateZipEntries(["safe/file.html", "../escape.html"]), /Unsafe ZIP entry/);
});

test("detects a uniform multi-page Claude canvas", () => {
  const html = '<section data-document-role="page" style="width:1080px; height:1080px"></section><section data-document-role="page" style="width:1080px; height:1080px"></section>';
  assert.deepEqual(detectHtmlPages(html), { count: 2, width: 1080, height: 1080 });
});

test("reads PNG dimensions and alpha without decoding untrusted image pixels", () => {
  const bytes = Buffer.alloc(26);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.writeUInt32BE(2000, 16);
  bytes.writeUInt32BE(3000, 20);
  bytes[25] = 6;
  assert.deepEqual(readPngDimensions(bytes), { width: 2000, height: 3000, alpha: true });
});

test("recognizes approved Pinterest 2:3 source dimensions", () => {
  assert.equal(isTwoByThree(2000, 3000), true);
  assert.equal(isTwoByThree(1080, 1350), false);
});

test("detects packaged font families without brand hard-coding", () => {
  const html = "<style>@font-face { font-family: 'Newsreader'; src: url(font.woff2) } @font-face { font-family: 'Sora'; src: url(other.woff2) }</style>";
  assert.deepEqual(detectFontFamilies(html), ["Newsreader", "Sora"]);
});

test("requires only packaged fonts actually used by the design", () => {
  const html = String.raw`<style>
    @font-face { font-family: 'Newsreader'; src: url(newsreader.woff2) }
    @font-face { font-family: 'Space Mono'; src: url(space-mono.woff2) }
  </style><section style=\"font-family:'Newsreader',serif\">Approved design</section>`;
  assert.deepEqual(detectRequiredFontFamilies(html), ["Newsreader"]);
});

test("maps only approved exact canvases to output presets", () => {
  assert.equal(exactPresetForCanvas(1080, 1350), "instagram_feed");
  assert.equal(exactPresetForCanvas(1080, 1920), "instagram_story");
  assert.throws(() => exactPresetForCanvas(1200, 1200), /No approved exact output preset/);
});

test("defines the complete first-release social output set with exact dimensions", () => {
  assert.deepEqual(CLAUDE_SOCIAL_PROFILES.map(({ preset, width, height }) => ({ preset, width, height })), [
    { preset: "instagram_square", width: 1080, height: 1080 },
    { preset: "instagram_feed", width: 1080, height: 1350 },
    { preset: "instagram_story", width: 1080, height: 1920 },
    { preset: "instagram_reel", width: 1080, height: 1920 },
    { preset: "facebook_feed", width: 1080, height: 1350 },
    { preset: "facebook_landscape", width: 1200, height: 630 },
    { preset: "facebook_story", width: 1080, height: 1920 },
    { preset: "facebook_reel", width: 1080, height: 1920 },
    { preset: "pinterest_standard", width: 1000, height: 1500 },
    { preset: "etsy_listing_landscape", width: 2667, height: 2000 },
    { preset: "etsy_listing_square", width: 2000, height: 2000 }
  ]);
});

test("renders only Hub-requested presets and rejects unknown keys", () => {
  assert.deepEqual(selectClaudeSocialProfiles(["facebook_landscape", "etsy_listing_square"]).map((profile) => profile.preset), ["facebook_landscape", "etsy_listing_square"]);
  assert.throws(() => selectClaudeSocialProfiles(["made_up_format"]), /Unsupported requested preset/);
});

test("adapts square Claude pages without non-proportional scaling", () => {
  const inner = '<html><body><section data-document-role="page" data-label="01" style="position:relative;width:1080px;height:1080px"><span style="position:absolute;left:900px;top:900px">x</span></section></body></html>';
  const bundled = `<script type="__bundler/template">${JSON.stringify(inner)}</script>`;
  const feed = adaptBundledClaudeHtml(bundled, CLAUDE_SOCIAL_PROFILES[1]);
  assert.match(feed, /height:1350px/);
  assert.match(feed, /top:1170px/);
  assert.doesNotMatch(feed, /scaleX|scaleY/);
  const pinterest = adaptBundledClaudeHtml(bundled, CLAUDE_SOCIAL_PROFILES[8]);
  assert.match(pinterest, /zoom:0\.9259259259259259/);
  const landscape = adaptBundledClaudeHtml(bundled, CLAUDE_SOCIAL_PROFILES[5]);
  assert.match(landscape, /width:1200px/);
  const etsy = adaptBundledClaudeHtml(bundled, CLAUDE_SOCIAL_PROFILES[9]);
  assert.match(etsy, /width:1440\.18px/);
});

test("prepares a square PNG as proportional foreground on every requested canvas", async () => {
  const png = Buffer.alloc(26);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
  png.writeUInt32BE(1080, 16);
  png.writeUInt32BE(1080, 20);
  png[25] = 6;
  const root = await mkdtemp(path.join(tmpdir(), "dopa-flat-png-"));
  const prepared = await prepareClaudeDesignPngVariants(png, root, "dopa", ["instagram_feed", "facebook_landscape"]);
  assert.deepEqual(prepared.variants.map((variant) => variant.preset), ["instagram_feed", "facebook_landscape"]);
  const html = await readFile(path.join(root, "instagram_feed-source", "source", "index.html"), "utf8");
  assert.match(html, /width:1080px;height:1350px/);
  assert.match(html, /class="foreground"/);
  assert.match(html, /object-fit:contain/);
  assert.match(html, /class="background"/);
});

test("flat PNG intake rejects non-square and implausible source dimensions", async () => {
  const png = Buffer.alloc(26);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
  png.writeUInt32BE(1080, 16);
  png.writeUInt32BE(1350, 20);
  await assert.rejects(() => prepareClaudeDesignPngVariants(png, tmpdir()), /requires a square source/);
});
