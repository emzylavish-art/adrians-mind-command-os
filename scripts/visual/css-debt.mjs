#!/usr/bin/env node
/** Report CSS complexity without mutating source. */
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = resolve("src");
const files = [];
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path);
    else if (path.endsWith(".css")) files.push(path);
  }
}
walk(root);
const report = files.map((file) => {
  const source = readFileSync(file, "utf8");
  return {
    file: relative(process.cwd(), file),
    lines: source.split("\n").length,
    important: (source.match(/!important/g) ?? []).length,
    mediaQueries: (source.match(/@media/g) ?? []).length,
    selectors: (source.match(/{/g) ?? []).length,
  };
});
const totals = report.reduce((sum, row) => ({
  lines: sum.lines + row.lines,
  important: sum.important + row.important,
  mediaQueries: sum.mediaQueries + row.mediaQueries,
  selectors: sum.selectors + row.selectors,
}), { lines: 0, important: 0, mediaQueries: 0, selectors: 0 });
const artifactDir = resolve(process.env.VISUAL_ARTIFACT_DIR ?? "artifacts/visual-audit");
mkdirSync(artifactDir, { recursive: true });
writeFileSync(join(artifactDir, "css-debt.json"), `${JSON.stringify({ totals, files: report }, null, 2)}\n`);
console.log(JSON.stringify({ totals, files: report.length }));
