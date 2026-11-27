// Bounded-memory verification of real dependency graphs. This does not replace
// the complete repository TypeScript gate in the integration environment.
import ts from "typescript";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const names = process.argv.slice(2);
if (!names.length) {
  console.error("Usage: node docs/audits/c2/check-types.mjs <repository-relative roots...>");
  process.exit(2);
}
const config = ts.readConfigFile(path.join(root, "tsconfig.json"), ts.sys.readFile);
if (config.error) {
  console.error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
  process.exit(1);
}
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
const program = ts.createProgram([
  ...names.map((name) => path.resolve(root, name)),
  ...parsed.fileNames.filter((name) => name.endsWith(".d.ts")),
], parsed.options);
const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
for (const diagnostic of diagnostics) {
  let location = "";
  if (diagnostic.file && diagnostic.start !== undefined) {
    const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
    location = `${path.relative(root, diagnostic.file.fileName)}:${position.line + 1}:${position.character + 1} `;
  }
  console.error(location + ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
}
console.log(`diagnostics=${diagnostics.length}`);
process.exitCode = diagnostics.length ? 1 : 0;
