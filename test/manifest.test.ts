import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { loadManifest, resolveInsidePackage } from "../src/core/manifest.js";

test("loads a minimal valid manifest", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "dopa-manifest-"));
  const file = path.join(directory, "manifest.json");
  await writeFile(file, JSON.stringify({ schema_version: 1, content_id: "x", brand: "test-brand", version: 1, source: "source/index.html", canvas: { width: 1, height: 1 }, outputs: [{ preset: "instagram_feed" }] }));
  assert.equal((await loadManifest(file)).content_id, "x");
});

test("rejects paths escaping the package", () => {
  assert.throws(() => resolveInsidePackage("/tmp/job/manifest.json", "../secret"), /escapes content package/);
});

test("loads a bounded multi-page selector", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "dopa-manifest-pages-"));
  const file = path.join(directory, "manifest.json");
  await writeFile(file, JSON.stringify({ schema_version: 1, content_id: "pages", brand: "test-brand", version: 1, source: "source/index.html", canvas: { width: 1080, height: 1080 }, pages: { selector: "[data-document-role=page]", label_attribute: "data-label", maximum: 28 }, outputs: [{ preset: "instagram_square" }] }));
  assert.equal((await loadManifest(file)).pages?.maximum, 28);
});

test("rejects an invalid page label attribute", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "dopa-manifest-pages-invalid-"));
  const file = path.join(directory, "manifest.json");
  await writeFile(file, JSON.stringify({ schema_version: 1, content_id: "pages", brand: "test-brand", version: 1, source: "source/index.html", canvas: { width: 1080, height: 1080 }, pages: { selector: "section", label_attribute: "bad attribute" }, outputs: [{ preset: "instagram_square" }] }));
  await assert.rejects(loadManifest(file), /valid HTML attribute name/);
});
