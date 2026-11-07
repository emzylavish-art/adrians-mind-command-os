import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire("/workspace/mind-command-os-loop2/package.json");
const path = "/workspace/mind-command-os-loop2/src/styles.css";
const css = readFileSync(path, "utf8");

// 1) Brace balance (catches the 4171bfc class of bugs)
let depth=0, line=1, col=0, max=0;
for (let i=0;i<css.length;i++){
  const ch=css[i];
  if(ch==='\n'){ line++; col=0; continue; }
  col++;
  if(ch==='{' ){ depth++; max=Math.max(max,depth); }
  if(ch==='}' ){ depth--; if(depth<0){ console.error(`EXTRA } at ${line}:${col}`); process.exit(1);} }
}
if(depth!==0){ console.error(`UNBALANCED braces leftover=${depth}`); process.exit(1); }
console.log(`brace-balance: OK (max depth ${max})`);

// 2) postcss parse
try {
  const postcss = require("postcss");
  postcss.parse(css, { from: path });
  console.log("postcss: OK");
} catch (e) {
  console.error("postcss FAIL:", e.reason || e.message, "line", e.line, "col", e.column);
  process.exit(1);
}

// 3) lightningcss with draft nesting if available
try {
  const lightning = require("lightningcss");
  const r = lightning.transform({
    filename: "styles.css",
    code: Buffer.from(css),
    minify: false,
    errorRecovery: false,
    drafts: { customMedia: true },
  });
  console.log("lightningcss: OK", r.code.length);
} catch (e) {
  // lightning may reject @theme / tailwind — treat postcss+braces as gate; log warning
  console.warn("lightningcss warn (non-gating if postcss OK):", (e.message||String(e)).slice(0,120));
}
console.log("CSS_PARSE_CHECK_PASS");
