import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const require = createRequire(join(root, "package.json"));
const paths = [
  join(root, "src/styles.css"),
  join(root, "src/styles-perf-gate.css"),
  join(root, "src/styles-visual-deferred.css"),
];

function checkFile(path) {
  const css = readFileSync(path, "utf8");
  let depth = 0,
    line = 1,
    col = 0,
    max = 0;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === "\n") {
      line++;
      col = 0;
      continue;
    }
    col++;
    if (ch === "{") {
      depth++;
      max = Math.max(max, depth);
    }
    if (ch === "}") {
      depth--;
      if (depth < 0) {
        console.error(`EXTRA } at ${path}:${line}:${col}`);
        process.exit(1);
      }
    }
  }
  if (depth !== 0) {
    console.error(`UNBALANCED braces leftover=${depth} in ${path}`);
    process.exit(1);
  }
  console.log(`brace-balance: OK ${path} (max depth ${max})`);
  try {
    const postcss = require("postcss");
    postcss.parse(css, { from: path });
    console.log("postcss: OK", path);
  } catch (e) {
    console.error("postcss FAIL:", path, e.reason || e.message, "line", e.line, "col", e.column);
    process.exit(1);
  }
}

for (const p of paths) checkFile(p);
console.log("CSS_PARSE_CHECK_PASS");
