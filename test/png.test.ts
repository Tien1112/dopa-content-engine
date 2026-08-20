import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { readPngMetadata } from "../src/core/png.js";

test("reads PNG dimensions and alpha from IHDR", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "dopa-png-"));
  const file = path.join(directory, "sample.png");
  const bytes = Buffer.alloc(26);
  Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(1080, 16);
  bytes.writeUInt32BE(1350, 20);
  bytes[25] = 6;
  await writeFile(file, bytes);
  assert.deepEqual(await readPngMetadata(file), { width: 1080, height: 1350, format: "png", alpha: true });
});
