import assert from "node:assert/strict";
import { test } from "node:test";
import { inspectCodeBuffer, knownCodeFilesFor, resolveKnownDependency, reviewedRelatedNavigation } from "./code-navigation.ts";

test("AA042 parser ignores comment/string decoys and locates actual typed symbols and imports", () => {
  const text = `// function fake() {} import bad from './fake';\nconst example = "class Fake {} import x from './fake'";\nimport { value } from './real';\nexport interface Item { id: string }\nexport function actual() { return value; }\nexport type Kind = string;\nclass Tool { run() {} }\nconst arrow = () => 1;\nexport { other } from '../other';\nimport('./lazy');`;
  const parsed = inspectCodeBuffer({ path: "src/file.tsx", text, revision: "saved-sha" });
  assert.equal(parsed.status, "parsed");
  assert.deepEqual(parsed.symbols.map((symbol) => symbol.name), ["example", "Item", "actual", "Kind", "Tool", "run", "arrow"]);
  assert.deepEqual(parsed.dependencies.map((item) => item.specifier), ["./real", "../other", "./lazy"]);
  const actual = parsed.symbols.find((symbol) => symbol.name === "actual")!;
  assert.equal(actual.line, 5); assert.equal(text.slice(actual.from, actual.to), "actual"); assert.equal(actual.exported, true);
  assert.equal(parsed.savedRevision, "saved-sha");
});

test("AA042 outline follows draft changes and rejects oversized or unsupported buffers honestly", () => {
  const first = inspectCodeBuffer({ path: "main.ts", text: "function first() {}", revision: "old" });
  const second = inspectCodeBuffer({ path: "main.ts", text: "\nfunction second() {}", revision: "new" });
  assert.notEqual(first.bufferRevision, second.bufferRevision); assert.equal(second.symbols[0].name, "second"); assert.equal(second.symbols[0].line, 2); assert.equal(second.savedRevision, "new");
  assert.equal(inspectCodeBuffer({ path: "large.ts", text: "x".repeat(200001) }).status, "oversize");
  assert.equal(inspectCodeBuffer({ path: "main.py", text: "def first(): pass" }).status, "unsupported");
  assert.equal(inspectCodeBuffer({ path: "invalid.ts", text: "export function ( {" }).partial, true);
});

test("AA042 related-file navigation uses selected-buffer workspace and refuses competing or stale targets", () => {
  const source = { workspace: "pc-a", cwd: "/work/a", path: "src/main.ts", revision: "reviewed", text: "import { x } from './dep';" };
  const known = knownCodeFilesFor(source, { target: { workspace: "pc-b", cwd: "/work/b" }, files: [{ path: "src/wrong.ts", bytes: 1 }] }, [{ ...source, path: "src/dep.ts", draft: "export const x = 1" }, { ...source, cwd: "/another", path: "src/other.ts", draft: "" }]);
  assert.deepEqual(known.map((item) => item.path), ["src/dep.ts"]);
  const dep = inspectCodeBuffer(source).dependencies[0];
  assert.deepEqual(resolveKnownDependency(source.path, dep, known), { status: "resolved", path: "src/dep.ts" });
  assert.equal(resolveKnownDependency(source.path, dep, [...known, { path: "src/dep.tsx" }]).status, "unavailable");
  assert.equal(resolveKnownDependency(source.path, { ...dep, specifier: "../../outside" }, known).status, "unavailable");
  const reviewed = reviewedRelatedNavigation(source, source, "src/dep.ts", known);
  assert.deepEqual(reviewed, { ok: true, target: { workspace: "pc-a", cwd: "/work/a" }, path: "src/dep.ts" });
  assert.equal(reviewedRelatedNavigation(source, { ...source, workspace: "pc-b" }, "src/dep.ts", known).ok, false);
  assert.equal(reviewedRelatedNavigation(source, { ...source, text: source.text + "// changed" }, "src/dep.ts", known).ok, false);
  assert.equal(reviewedRelatedNavigation(source, source, "src/wrong.ts", known).ok, false);
});
