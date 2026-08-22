import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { inspectPackage } from "../src/core/inspect.js";

async function withPackage(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), "dopa-inspect-"));
  try {
    await mkdir(path.join(directory, "source"));
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("ignores JavaScript object URLs and serialized templates", async () => {
  await withPackage(async (directory) => {
    const source = path.join(directory, "source", "index.html");
    await writeFile(path.join(directory, "source", "asset.png"), "png");
    await writeFile(source, `<!doctype html>
      <style>.card { background-image: url("asset.png"); }</style>
      <img src="asset.png" style="mask-image: url('asset.png')">
      <script>
        URL.createObjectURL(pageBlob);
        URL.createObjectURL(blob);
        const template = '<img src="not-a-real-outer-dependency.png">';
      </script>
      <script type="application/json">{"html":"url(\\\"\\\\\\\"\\\")"}</script>`);

    const report = await inspectPackage(directory, source);
    assert.deepEqual(report.localDependencies, ["asset.png"]);
    assert.deepEqual(report.issues, []);
  });
});

test("still rejects missing markup dependencies", async () => {
  await withPackage(async (directory) => {
    const source = path.join(directory, "source", "index.html");
    await writeFile(source, '<!doctype html><img src="missing.png">');
    const report = await inspectPackage(directory, source);
    assert.deepEqual(report.localDependencies, ["missing.png"]);
    assert.deepEqual(report.issues, ["Missing local dependency: missing.png"]);
  });
});

test("still rejects external markup and CSS dependencies", async () => {
  await withPackage(async (directory) => {
    const source = path.join(directory, "source", "index.html");
    await writeFile(source, '<!doctype html><link href="https://example.com/font.css"><style>body{background:url(//example.com/image.png)}</style>');
    const report = await inspectPackage(directory, source);
    assert.deepEqual(report.remoteDependencies, ["https://example.com/font.css", "//example.com/image.png"]);
    assert.match(report.issues[0] ?? "", /External network dependencies are not deterministic/);
  });
});
