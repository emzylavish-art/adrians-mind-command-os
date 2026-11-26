import { readFileSync } from "node:fs";
import { dirname, posix, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const HOOKS = new Set(["useState", "useReducer", "useEffect", "useLayoutEffect", "useRef", "useSyncExternalStore"]);
const FEATURE_RULES = [
  ["styles", /\.(?:css|scss)$/],
  ["voice", /voice|speak|dictation|avatar|characters/],
  ["media", /\/media\b|image|video/],
  ["knowledge", /memory|knowledge/],
  ["models", /provider|model|routing|logic-route|xai|grok/],
  ["integrations", /mcp|notion|connect|service-board/],
  ["agents", /fleet|agent|schedule|orchestrator/],
  ["build", /build|workbench|kimi|computer/],
  ["research", /research|search/],
  ["projects", /project/],
  ["library", /library|document|files/],
  ["account", /auth|account|supabase|session/],
  ["persistence", /\/lib\/(?:db|mind\/(?:store|sync|workspace|persistence|use-mind-workspace))/],
  ["notifications", /notification/],
  ["navigation", /navigation|nav|palette|location|routes/],
  ["conversations", /chat|conversation|transcript|message|composer/],
  ["settings", /accessibility|preference|settings|theme|motion/],
];
function area(specifier) { return FEATURE_RULES.find(([, pattern]) => pattern.test(specifier))?.[0] ?? "shared"; }
function isRuntimeImport(node) {
  const clause = node.importClause;
  if (!clause) return true;
  if (clause.isTypeOnly) return false;
  if (clause.name) return true;
  const named = clause.namedBindings;
  return !named || !ts.isNamedImports(named) || named.elements.some((element) => !element.isTypeOnly);
}

/** AST counts exclude comments, string examples and erased type-only dependencies. */
export function measureFrontendSource(file, content) {
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, file.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const imports = new Set(); const allRuntimeImports = new Set(); const aliases = new Map(); const namespaces = new Set();
  for (const node of source.statements) {
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) continue;
    const specifier = node.moduleSpecifier.text;
    if (isRuntimeImport(node)) { allRuntimeImports.add(specifier); if (specifier.startsWith("@/") || specifier.startsWith(".")) imports.add(specifier); }
    if (specifier !== "react" || !node.importClause || node.importClause.isTypeOnly) continue;
    const clause = node.importClause;
    if (clause.name) namespaces.add(clause.name.text);
    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) namespaces.add(clause.namedBindings.name.text);
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) for (const binding of clause.namedBindings.elements) {
      const original = binding.propertyName?.text ?? binding.name.text;
      if (!binding.isTypeOnly && HOOKS.has(original)) aliases.set(binding.name.text, original);
    }
  }
  const hooks = Object.fromEntries([...HOOKS].map((name) => [name, 0]));
  let largestFunctionLines = 0;
  function walk(node) {
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      if (expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) {
        const specifier = node.arguments[0].text;
        allRuntimeImports.add(specifier);
        if (specifier.startsWith("@/") || specifier.startsWith(".")) imports.add(specifier);
      }
      const hook = ts.isIdentifier(expression) ? aliases.get(expression.text) : ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression) && namespaces.has(expression.expression.text) ? expression.name.text : undefined;
      if (hook && HOOKS.has(hook)) hooks[hook] += 1;
    }
    if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) && node.body) {
      const start = source.getLineAndCharacterOfPosition(node.getStart()).line;
      const end = source.getLineAndCharacterOfPosition(node.end).line;
      largestFunctionLines = Math.max(largestFunctionLines, end - start + 1);
    }
    ts.forEachChild(node, walk);
  }
  walk(source);
  const runtimeImports = [...imports].sort();
  return { file, lines: content.split(/\r?\n/).length, largestFunctionLines, stateHooks: hooks.useState + hooks.useReducer, effects: hooks.useEffect + hooks.useLayoutEffect, refs: hooks.useRef, externalStores: hooks.useSyncExternalStore, hooks, runtimeDependencyCount: runtimeImports.length, runtimeImports, featureAreas: [...new Set(runtimeImports.map(area))].sort(), externalRuntimeImports: [...allRuntimeImports].filter((item) => !imports.has(item)).sort() };
}

function importedFile(from, specifier, tracked) {
  const base = specifier.startsWith("@/") ? `src/${specifier.slice(2)}` : specifier.startsWith(".") ? posix.normalize(posix.join(posix.dirname(from), specifier)) : null;
  if (!base) return null;
  return [base, `${base}.tsx`, `${base}.ts`, `${base}/index.tsx`, `${base}/index.ts`].find((candidate) => tracked.has(candidate)) ?? null;
}

/** A review gate, not an automatic quality score or a reason to split files by arbitrary lines. */
export function reviewFrontendArchitecture(sources, baseline) {
  const metrics = Object.fromEntries(Object.entries(sources).map(([file, content]) => [file, measureFrontendSource(file, content)]));
  const violations = []; const signals = []; const tracked = new Set(Object.keys(metrics));
  for (const [file, expected] of Object.entries(baseline.files)) {
    const measured = metrics[file];
    if (!measured) { violations.push({ file, kind: "missing-boundary", detail: "A tracked feature boundary is missing." }); continue; }
    const newAreas = measured.featureAreas.filter((item) => !expected.featureAreas.includes(item));
    if (newAreas.length) violations.push({ file, kind: "new-feature-coupling", detail: `New direct feature areas require an ownership review: ${newAreas.join(", ")}.` });
    const addedImports = measured.runtimeImports.filter((item) => !expected.runtimeImports.includes(item));
    if (addedImports.length) signals.push({ file, kind: "new-runtime-dependencies", imports: addedImports });
    for (const metric of ["lines", "largestFunctionLines", "stateHooks", "effects", "refs", "runtimeDependencyCount"]) {
      const limit = expected.limits[metric];
      if (typeof limit === "number" && measured[metric] > limit) violations.push({ file, kind: "budget-growth", detail: `${metric} is ${measured[metric]}, above the reviewed limit ${limit}.` });
    }
    if (expected.presentationOnly) {
      const disallowed = measured.runtimeImports.filter((item) => /(?:\.server(?:\.[cm]?[jt]sx?)?$|\/lib\/db(?:\.[cm]?[jt]s)?$|\/api\/|\/auth\/client(?:\.[cm]?[jt]s)?$|\/mind\/(?:server|store|use-mind-workspace|xai-adapter|fleet-connected-adapters)(?:\.server)?(?:\.[cm]?[jt]sx?)?$|(?:^|\/)command-app(?:\.[cm]?[jt]sx?)?$)/.test(item));
      if (disallowed.length) violations.push({ file, kind: "presentation-side-effect-import", detail: `Presentation must emit typed callbacks instead of acquiring service or persistence ownership: ${disallowed.join(", ")}.` });
    }
  }
  const visiting = new Set(); const visited = new Set(); const cycles = new Set();
  function visit(file, path) {
    if (visiting.has(file)) { const cycle = [...path.slice(path.indexOf(file)), file].join(" → "); if (!cycles.has(cycle)) { cycles.add(cycle); violations.push({ file, kind: "feature-cycle", detail: cycle }); } return; }
    if (visited.has(file)) return;
    visiting.add(file);
    for (const dependency of metrics[file].runtimeImports) { const next = importedFile(file, dependency, tracked); if (next) visit(next, [...path, file]); }
    visiting.delete(file); visited.add(file);
  }
  for (const file of tracked) visit(file, []);
  return { ok: violations.length === 0, metrics, violations, signals };
}

export function readFrontendArchitecture(root = resolve(dirname(fileURLToPath(import.meta.url)), "..")) {
  const baseline = JSON.parse(readFileSync(resolve(root, "scripts/frontend-architecture-baseline.json"), "utf8"));
  const sources = {};
  for (const file of Object.keys(baseline.files)) {
    try { sources[file] = readFileSync(resolve(root, file), "utf8"); } catch { /* Report missing boundaries through the review result. */ }
  }
  return reviewFrontendArchitecture(sources, baseline);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = readFrontendArchitecture();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
