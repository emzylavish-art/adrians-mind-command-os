#!/usr/bin/env node
/**
 * Static inventory of clickable controls and form wiring.
 * No AI calls, production mutations, paid credentials or browser access.
 * A handler is not evidence that a real backend operation works.
 */
import ts from "typescript";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = resolve(".");
const files = [];
function collect(dir) {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, item.name);
    if (item.isDirectory()) {
      if (!["node_modules", "generated", "dist"].includes(item.name)) collect(path);
    } else if (item.name.endsWith(".tsx") && !item.name.endsWith(".test.tsx")) {
      files.push(path);
    }
  }
}
for (const p of ["src/components", "src/routes"]) collect(join(root, p));
const records = [];
const observed = new Set(["button", "input", "select", "textarea", "a"]);
const toText = (expr, src) => expr ? expr.getText(src).replace(/\s+/g, " ").slice(0, 160) : "";
for (const file of files) {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source);
      if (observed.has(tag)) {
        const attributes = node.attributes.properties;
        const attr = (key) => attributes.find((a) => ts.isJsxAttribute(a) && a.name.text === key);
        const hasSpread = attributes.some(ts.isJsxSpreadAttribute);
        const onClick = attr("onClick");
        const href = attr("href");
        const onChange = attr("onChange");
        const disabled = attr("disabled");
        const typeAttr = attr("type");
        const typ = typeAttr && ts.isJsxAttribute(typeAttr) && typeAttr.initializer &&
          ts.isStringLiteral(typeAttr.initializer) ? typeAttr.initializer.text : "";
        const isSubmit = tag === "button" && typ === "submit";
        let classification = "requires-review";
        if (tag === "a") classification = href ? "navigation-wired" : "unwired";
        if (tag === "button") classification = onClick ? "handler-wired" : isSubmit ? "submit-wired" : hasSpread ? "requires-review" : "unwired";
        if (["select", "textarea", "input"].includes(tag)) {
          classification = onChange ? "change-wired" : hasSpread ? "requires-review" : "unwired";
        }
        const loc = source.getLineAndCharacterOfPosition(node.getStart(source));
        let label = "";
        if (ts.isJsxOpeningElement(node) && node.parent && ts.isJsxElement(node.parent)) {
          label = node.parent.children.map((x) => ts.isJsxText(x) ? x.text : "").join(" ").replace(/\s+/g, " ").trim().slice(0, 100);
        }
        records.push({
          file: relative(root, file).replaceAll("\\", "/"),
          line: loc.line + 1, tag, type: typ,
          label: label || toText(attr("aria-label")?.initializer, source) || "",
          classification, handler: toText(onClick?.initializer ?? onChange?.initializer, source),
          hasSpread, mayBeDisabled: Boolean(disabled),
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}
const summary = {
  generatedAt: new Date().toISOString(), filesScanned: files.length,
  totalControls: records.length,
  counts: Object.fromEntries([...new Set(records.map((r) => r.classification))]
    .sort().map((name) => [name, records.filter((r) => r.classification === name).length])),
  note: "Static inventory only. Handler-wired does not mean backend-verified; unwired inputs may be intentionally read-only.",
};
mkdirSync(join(root, "out"), { recursive: true });
writeFileSync(join(root, "out/interface-audit.json"), JSON.stringify({ summary, controls: records }, null, 2) + "\n");
const rows = records.filter((r) => ["unwired", "requires-review"].includes(r.classification));
const markdown = [
  "# Adrian's Mind — UI action audit",
  "", "Generated: " + summary.generatedAt, "",
  "Static evidence only. Browser and backend end-to-end verification remains required.", "",
  "## Summary", "",
  "- Files scanned: " + summary.filesScanned,
  "- Controls inventoried: " + summary.totalControls,
  ...Object.entries(summary.counts).map(([key, value]) => "- " + key + ": " + value),
  "", "## Controls requiring review", "",
  "| File | Line | Element | Status | Label |",
  "|---|---:|---|---|---|",
  ...rows.map((r) => "| " + r.file.replaceAll("|", "\\|") + " | " + r.line +
    " | " + r.tag + " | " + r.classification + " | " + r.label.replaceAll("|", "\\|") + " |"),
  "", "## Test policy", "",
  "For each control, verify frontend action, authorization, backend operation,",
  "provider/worker result, persistence, and honest error/success feedback.", "",
].join("\n");
writeFileSync(join(root, "out/interface-audit.md"), markdown);
console.log(JSON.stringify(summary, null, 2));
