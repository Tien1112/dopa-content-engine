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
