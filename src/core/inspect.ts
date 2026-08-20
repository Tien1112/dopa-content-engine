import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { InspectionReport } from "./types.js";

async function walk(directory: string, root = directory): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute, root) : [path.relative(root, absolute)];
  }));
  return nested.flat().sort();
}

export async function inspectPackage(packageRoot: string, sourcePath: string): Promise<InspectionReport> {
  const html = await readFile(sourcePath, "utf8");
  const dependencyPattern = /(?:src|href)\s*=\s*["']([^"'#]+)|url\(\s*["']?([^"')]+)|@import\s+["']([^"']+)/gi;
  const dependencies = [...html.matchAll(dependencyPattern)].map((m) => m[1] ?? m[2] ?? m[3]).filter((v): v is string => Boolean(v));
  const remoteDependencies = dependencies.filter((item) => /^(?:https?:)?\/\//i.test(item));
  const localDependencies = dependencies.filter((item) => !/^(?:https?:)?\/\//i.test(item) && !/^(?:data:|blob:|#)/i.test(item));
  const fontFaces = [...html.matchAll(/@font-face\s*{[^}]*font-family\s*:\s*["']?([^;"'}]+)/gis)].map((m) => m[1]!.trim());
  const animationSignals = [
    /@keyframes/i.test(html) ? "css-keyframes" : "",
    /animation(?:-name)?\s*:/i.test(html) ? "css-animation" : "",
    /requestAnimationFrame\s*\(/i.test(html) ? "request-animation-frame" : "",
    /<video\b/i.test(html) ? "video" : ""
  ].filter(Boolean);
  const issues: string[] = [];
  for (const dependency of localDependencies) {
    const cleaned = decodeURIComponent(dependency.split(/[?#]/, 1)[0]!);
    const resolved = path.resolve(path.dirname(sourcePath), cleaned);
    if (!resolved.startsWith(`${packageRoot}${path.sep}`)) issues.push(`Dependency escapes package: ${dependency}`);
    else { try { await access(resolved); } catch { issues.push(`Missing local dependency: ${dependency}`); } }
  }
  if (remoteDependencies.length) issues.push(`External network dependencies are not deterministic: ${remoteDependencies.join(", ")}`);
  return { source: path.relative(packageRoot, sourcePath), files: await walk(packageRoot), localDependencies, remoteDependencies, fontFaces, animationSignals, issues };
}
