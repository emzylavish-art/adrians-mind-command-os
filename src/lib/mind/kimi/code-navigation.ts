import { javascriptLanguage, jsxLanguage, typescriptLanguage, tsxLanguage } from "@codemirror/lang-javascript";
import type { SyntaxNode } from "@lezer/common";

export type CodeWorkspace = { workspace: string; cwd?: string };
export type CodeBufferSource = CodeWorkspace & { path: string; revision?: string; text: string };
export type CodeSymbol = { name: string; kind: string; line: number; from: number; to: number; exported: boolean };
export type CodeDependency = { specifier: string; kind: "import" | "re-export" | "dynamic-import" | "require"; line: number; from: number; to: number; literal: boolean };
export type BufferNavigation = { status: "parsed" | "unsupported" | "oversize"; savedRevision: string | null; bufferRevision: string; symbols: CodeSymbol[]; dependencies: CodeDependency[]; partial: boolean; detail: string };
export const MAX_NAVIGATION_CHARACTERS = 200_000;
const MAX_ENTRIES = 200;
/** A UI invalidation key, never a security or repository revision. */
function bufferRevision(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return `${text.length}:${(hash >>> 0).toString(16)}`;
}
export function inspectCodeBuffer(input: { path: string; text: string; revision?: string }): BufferNavigation {
  const base = { savedRevision: input.revision ?? null, bufferRevision: bufferRevision(input.text), symbols: [] as CodeSymbol[], dependencies: [] as CodeDependency[], partial: false };
  const extension = input.path.split(".").at(-1)?.toLowerCase();
  const language = extension === "tsx" ? tsxLanguage : extension === "jsx" ? jsxLanguage : ["ts", "mts", "cts"].includes(extension ?? "") ? typescriptLanguage : ["js", "mjs", "cjs"].includes(extension ?? "") ? javascriptLanguage : null;
  if (!language) return { ...base, status: "unsupported", detail: "Local syntax navigation supports JavaScript and TypeScript buffers only. Other language symbols have not been inspected." };
  if (input.text.length > MAX_NAVIGATION_CHARACTERS) return { ...base, status: "oversize", detail: "This buffer exceeds the 200,000-character local syntax budget. No partial symbol list is presented as complete." };
  const tree = language.parser.parse(input.text);
  const starts = [0];
  for (let index = 0; index < input.text.length; index++) if (input.text[index] === "\n") starts.push(index + 1);
  const line = (offset: number) => { let lo = 0, hi = starts.length; while (lo + 1 < hi) { const mid = Math.floor((lo + hi) / 2); if (starts[mid] <= offset) lo = mid; else hi = mid; } return lo + 1; };
  const symbols: CodeSymbol[] = [], dependencies: CodeDependency[] = [];
  let parseErrors = false, bounded = false;
  const addSymbol = (node: SyntaxNode, name: SyntaxNode | null, kind: string) => {
    if (!name) return;
    if (symbols.length >= MAX_ENTRIES) { bounded = true; return; }
    symbols.push({ name: input.text.slice(name.from, name.to).slice(0, 200), kind, line: line(node.from), from: name.from, to: name.to, exported: node.parent?.name === "ExportDeclaration" });
  };
  const addDependency = (node: SyntaxNode, value: SyntaxNode | null, kind: CodeDependency["kind"]) => {
    if (dependencies.length >= MAX_ENTRIES) { bounded = true; return; }
    const raw = value ? input.text.slice(value.from, value.to) : "";
    const literal = Boolean(value && value.name === "String" && /^["']/.test(raw) && raw.at(-1) === raw[0] && !raw.includes("\\"));
    dependencies.push({ specifier: literal ? raw.slice(1, -1) : "Computed or escaped module path", literal, kind, line: line(node.from), from: node.from, to: node.to });
  };
  tree.iterate({ enter(ref) {
    const node = ref.node;
    if (node.type.isError) parseErrors = true;
    if (["LineComment", "BlockComment", "String", "TemplateString"].includes(node.name)) return false;
    if (node.name === "FunctionDeclaration") addSymbol(node, node.getChild("VariableDefinition"), "function");
    if (node.name === "ClassDeclaration") addSymbol(node, node.getChild("VariableDefinition"), "class");
    if (node.name === "InterfaceDeclaration") addSymbol(node, node.getChild("TypeDefinition"), "interface");
    if (node.name === "TypeAliasDeclaration") addSymbol(node, node.getChild("TypeDefinition"), "type");
    if (node.name === "EnumDeclaration") addSymbol(node, node.getChild("TypeDefinition") ?? node.getChild("VariableDefinition"), "enum");
    if (node.name === "VariableDeclaration") for (const name of node.getChildren("VariableDefinition")) addSymbol(node, name, "variable");
    if (node.name === "MethodDeclaration") addSymbol(node, node.getChild("PropertyDefinition") ?? node.getChild("PrivatePropertyDefinition"), "method");
    if (node.name === "ImportDeclaration") addDependency(node, node.getChild("String"), "import");
    if (node.name === "ExportDeclaration" && node.getChild("String")) addDependency(node, node.getChild("String"), "re-export");
    if (node.name === "DynamicImport") addDependency(node, node.getChild("String"), "dynamic-import");
    if (node.name === "CallExpression" && node.firstChild?.name === "VariableName" && input.text.slice(node.firstChild.from, node.firstChild.to) === "require") addDependency(node, node.getChild("ArgList")?.getChild("String") ?? null, "require");
  } });
  return { ...base, status: "parsed", symbols, dependencies, partial: parseErrors || bounded, detail: `${parseErrors ? "Syntax errors detected; entries may be incomplete. " : ""}${bounded ? "Results are limited to 200 symbols and 200 dependencies. " : ""}Current-buffer syntax only. Imports are declarations, not verified runtime dependencies; no whole-project semantic analysis is claimed.` };
}
export function sameCodeWorkspace(a: CodeWorkspace | undefined, b: CodeWorkspace | undefined): boolean { return Boolean(a && b && a.workspace === b.workspace && (a.cwd ?? "") === (b.cwd ?? "")); }
export function knownCodeFilesFor(source: CodeWorkspace, listing: { target?: CodeWorkspace; files: { path: string; bytes: number }[] }, buffers: (CodeWorkspace & { path: string; draft: string })[]): { path: string; bytes: number }[] {
  const rows = [...(sameCodeWorkspace(source, listing.target) ? listing.files : []), ...buffers.filter((buffer) => sameCodeWorkspace(source, buffer)).map((buffer) => ({ path: buffer.path, bytes: buffer.draft.length }))];
  return [...new Map(rows.map((row) => [row.path, row])).values()].slice(0, 5000);
}
function relativePath(value: string): string | null {
  if (!value || value.startsWith("/") || value.includes("\\") || /^[A-Za-z]:/.test(value) || value.includes("\0")) return null;
  const parts: string[] = [];
  for (const part of value.split("/")) { if (!part || part === ".") continue; if (part === "..") { if (!parts.length) return null; parts.pop(); } else parts.push(part); }
  return parts.join("/") || null;
}
export function resolveKnownDependency(fromPath: string, dependency: CodeDependency, knownFiles: { path: string }[]): { status: "resolved"; path: string } | { status: "unavailable"; reason: string } {
  if (!dependency.literal) return { status: "unavailable", reason: "Computed or escaped imports need manual review." };
  if (!dependency.specifier.startsWith("./") && !dependency.specifier.startsWith("../")) return { status: "unavailable", reason: "Package or alias resolution is outside this local file view." };
  const parent = relativePath(fromPath)?.split("/").slice(0, -1).join("/");
  if (parent === undefined) return { status: "unavailable", reason: "The source file is not a workspace-relative path." };
  const base = relativePath(`${parent ? `${parent}/` : ""}${dependency.specifier}`);
  if (!base) return { status: "unavailable", reason: "The dependency is outside the selected workspace." };
  const known = new Set(knownFiles.map((file) => relativePath(file.path)).filter(Boolean));
  if (known.has(base)) return { status: "resolved", path: base };
  const stem = /\.[cm]?jsx?$/.test(base) ? base.replace(/\.[cm]?jsx?$/, "") : base;
  const candidates = [`${stem}.ts`, `${stem}.tsx`, `${stem}.mts`, `${stem}.cts`, `${base}.js`, `${base}.jsx`, `${base}.mjs`, `${base}.cjs`, ...["ts", "tsx", "js", "jsx"].map((ext) => `${base}/index.${ext}`)].filter((candidate) => known.has(candidate));
  const matches = [...new Set(candidates)];
  return matches.length === 1 ? { status: "resolved", path: matches[0] } : { status: "unavailable", reason: matches.length > 1 ? "More than one known file matches. Choose the intended file explicitly." : "No matching file is loaded or listed for this workspace; browse more files to resolve it." };
}
export function reviewedRelatedNavigation(source: CodeBufferSource, current: CodeBufferSource | undefined, targetPath: string, knownFiles: { path: string }[]): { ok: true; target: CodeWorkspace; path: string } | { ok: false; error: string } {
  if (!current || !sameCodeWorkspace(source, current) || source.path !== current.path || source.revision !== current.revision || source.text !== current.text) return { ok: false, error: "The source buffer or workspace changed. Review its current dependencies again." };
  const target = relativePath(targetPath);
  if (!target || !knownFiles.some((file) => file.path === target)) return { ok: false, error: "That related file is not known in the selected buffer's workspace." };
  return { ok: true, target: { workspace: current.workspace, ...(current.cwd ? { cwd: current.cwd } : {}) }, path: target };
}
