import { readFile } from "node:fs/promises";
import path from "node:path";

const reportPath = path.resolve(process.argv[2] ?? "");
const expected = Number(process.argv[3]);
if (!reportPath || !Number.isInteger(expected) || expected < 1) throw new Error("Usage: node scripts/assert-qa.mjs <qa-report.json> <expected-output-count>");
const report = JSON.parse(await readFile(reportPath, "utf8"));
const failures = report.outputs.filter((output) => output.qa !== "passed");
if (report.status !== "passed" || report.outputs.length !== expected || failures.length) {
  throw new Error(`QA failed: status=${report.status}, outputs=${report.outputs.length}/${expected}, failed=${failures.length}`);
}
console.log(`QA passed: ${expected} outputs in ${reportPath}`);
