/** Actual before/after TSX in a deterministic hooks/reconciliation host, not
 * React DOM. Run the separate profile-c4-history.mjs for browser measurements. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { renderer } from "../src/components/mind/message-rendering.fixture.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const baseline = process.argv[2] ?? "18d5b9364e6bdcfec028eeccf56fe596946ed8ce";
if (!/^[a-f\d]{40}$/.test(baseline)) throw Error("Pass a full baseline Git SHA.");
const before = execFileSync("git", ["show", `${baseline}:src/components/mind/message-body.tsx`], { cwd: root, encoding: "utf8" });
const results = [];
for (const count of [20, 200, 1000]) {
  for (const variant of ["before", "after"]) {
    const app = renderer(variant === "before" ? before : undefined);
    const history = Array.from({ length: count }, (_, index) => `History ${index}: **safe formatting** [source](https://example.invalid/${index})\n\n\`\`\`ts\nconst n = ${index};\n\`\`\`\nAfter code`);
    const draw = (tick) => app.render([
      ...history.map((text, index) => app.jsx(app.AnswerTabs, { text, onEditImagine: () => tick }, `history-${index}`)),
      app.jsx(app.MessageBody, { text: `Streaming update ${tick}` }, "live"),
    ]);
    draw(0);
    const initial = { ...app.counts };
    for (let tick = 1; tick <= 20; tick++) draw(tick);
    const result = { count, variant, updates: 20, initialBlockParses: initial.blocks, initialMarkdownParses: initial.markdown,
      updateBlockParses: app.counts.blocks - initial.blocks, updateMarkdownParses: app.counts.markdown - initial.markdown };
    assert.equal(result.initialBlockParses, count * 2 + 1);
    assert.equal(result.initialMarkdownParses, count * 2 + 1);
    assert.equal(result.updateBlockParses, variant === "after" ? 20 : (count * 2 + 1) * 20);
    assert.equal(result.updateMarkdownParses, variant === "after" ? 20 : (count * 2 + 1) * 20);
    results.push(result);
  }
}
console.log(JSON.stringify({baseline, evidence:"Actual before/after TSX and parser calls in a deterministic hooks/reconciliation fixture. React DOM, wall time, frame rate, input latency and physical devices are not measured.", results}, null, 2));
