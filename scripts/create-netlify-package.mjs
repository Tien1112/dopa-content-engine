import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const sourceRoot = path.resolve(process.argv[2] ?? "work/dopa-approval");
const outputRoot = path.resolve(process.argv[3] ?? "work/dopa-netlify-site");
const workspaceRoot = process.cwd();
if (!outputRoot.startsWith(`${workspaceRoot}${path.sep}work${path.sep}`)) throw new Error("Netlify output must stay inside this repository's work directory");
await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
await cp(path.join(sourceRoot, "index.html"), path.join(outputRoot, "index.html"));
await cp(path.join(sourceRoot, "production", "social"), path.join(outputRoot, "production", "social"), { recursive: true });
await writeFile(path.join(outputRoot, "netlify.toml"), `[build]\n  publish = "."\n\n[[headers]]\n  for = "/*"\n  [headers.values]\n    X-Content-Type-Options = "nosniff"\n    Referrer-Policy = "no-referrer"\n    Content-Security-Policy = "default-src 'self'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; object-src 'none'; base-uri 'self'"\n`);

const html = await readFile(path.join(outputRoot, "index.html"), "utf8");
if (/127\.0\.0\.1|file:\/\/|\/Users\//.test(html)) throw new Error("Deployable HTML still contains a local URL or filesystem path");
const localRefs = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)].map((match) => match[1]).filter((value) => !/^(?:data:|https?:|blob:)/.test(value));
for (const reference of new Set(localRefs)) await access(path.join(outputRoot, decodeURIComponent(reference)));
console.log(JSON.stringify({ output: outputRoot, referenced_files: new Set(localRefs).size, local_path_check: "passed" }, null, 2));
