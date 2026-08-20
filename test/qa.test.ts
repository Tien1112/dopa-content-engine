import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { verifyPng } from "../src/core/qa.js";

test("fails exact-size QA when PNG dimensions differ", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "dopa-qa-"));
  const file = path.join(directory, "sample.png");
  const bytes = Buffer.alloc(26);
  Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(100, 16);
  bytes.writeUInt32BE(200, 20);
  bytes[25] = 6;
  await writeFile(file, bytes);
  const qa = await verifyPng({ preset: "test", file, reportFile: "renders/test.png", expectedWidth: 1080, expectedHeight: 1350, requireAlpha: false, fontsLoaded: true, assetsLoaded: true });
  assert.equal(qa.qa, "failed");
  assert.match(qa.errors[0]!, /Expected 1080x1350/);
});
