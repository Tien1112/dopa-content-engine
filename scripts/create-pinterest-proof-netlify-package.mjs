import { access, cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const sourceRoot = path.resolve(process.argv[2] ?? "work/pinterest-reflow-proof");
const outputRoot = path.resolve(process.argv[3] ?? "work/dopa-pinterest-proof-netlify");
const allowedRoot = path.resolve("work");

if (!outputRoot.startsWith(`${allowedRoot}${path.sep}`)) {
  throw new Error("Netlify output must stay inside this repository's work directory");
}

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
await cp(sourceRoot, outputRoot, { recursive: true });
await writeFile(
  path.join(outputRoot, "netlify.toml"),
  `[build]\n  publish = "."\n\n[[headers]]\n  for = "/*"\n  [headers.values]\n    X-Content-Type-Options = "nosniff"\n    Referrer-Policy = "no-referrer"\n    Content-Security-Policy = "default-src 'self'; img-src 'self' data: blob:; font-src 'self'; frame-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'"\n`
);

const htmlFiles = (await walk(outputRoot)).filter((file) => file.endsWith(".html"));
for (const htmlFile of htmlFiles) {
  const html = await readFile(htmlFile, "utf8");
  if (/127\.0\.0\.1|localhost|file:\/\/|\/Users\//.test(html)) {
    throw new Error(`Deployable HTML contains a local URL or filesystem path: ${htmlFile}`);
  }
  const baseHref = html.match(/<base\b[^>]*href=["']([^"']+)["']/i)?.[1];
  const documentBase = baseHref && !baseHref.startsWith("/")
    ? path.resolve(path.dirname(htmlFile), baseHref)
    : path.dirname(htmlFile);
  const refs = [...html.matchAll(/(?:src|href)=["']([^"'#]+)["']/g)]
    .map((match) => match[1])
    .filter((value) => value !== baseHref && !/^(?:data:|blob:|https?:)/.test(value));
  for (const reference of new Set(refs)) {
    const target = reference.startsWith("/")
      ? path.join(outputRoot, reference.slice(1))
      : path.resolve(documentBase, reference);
    await access(target);
  }
}

console.log(JSON.stringify({ output: outputRoot, html_files: htmlFiles.length, dependency_check: "passed" }, null, 2));

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolute));
    else files.push(absolute);
  }
  return files;
}
