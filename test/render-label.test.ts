import assert from "node:assert/strict";
import test from "node:test";
import { safeLabel } from "../src/core/render.js";

test("normalizes page labels for deterministic filenames", () => {
  assert.equal(safeLabel("N° 01 · A little wild"), "n-01-a-little-wild");
  assert.equal(safeLabel("  "), "page");
});
