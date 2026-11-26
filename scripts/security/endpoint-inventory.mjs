import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

/** AA060: policy categories are explicit. A device/OAuth credential is not a
 * browser session, and a public status exception must never be inferred. */
export const ENDPOINT_POLICIES = Object.freeze({
  owner_read: 'Verified owner; return only owner-scoped records. Reads do not grant dispatch authority.',
  owner_origin: 'Verified owner plus browser origin protection before mutation; recheck destination/approval and halt at dispatch.',
  owner_fetch_metadata: 'Verified owner plus Fetch-Metadata isolation; explicit bearer callers remain authenticated.',
  owner_rpc: 'authMiddleware verifies owner and request isolation; context.userId scopes stored data.',
  optional_owner_rpc: 'Explicit public/status result when signed out; owner data requires independently verified session and isolation.',
  oauth_callback: 'Owner-bound, expiring, single-use state and callback checks; provider redirect is intentionally not same-origin.',
  framework_auth: 'Authentication framework owns session establishment, trusted-origin and callback checks.',
  credential_establishment: 'Origin-protected pre-login action; supplied credentials/provider flow establishes identity, no preexisting owner required.',
  session_probe: 'Verify current session or return signed-out state; no mutation or provider dispatch.',
  paired_device: 'Verify device token/code, revocation and job ownership. Cookie presence alone never authorizes device execution.',
  mixed_owner_device: 'Dispatch-specific owner or device credentials; browser owner mutations require origin guard; device actions keep job binding.',
  public_status: 'Explicit sanitized readiness/manifest result; never return credentials, private account records or execute an action.',
  public_verification: 'Verify supplied public manifest/signature only; cannot mutate an account or execute device commands.',
  local_only: 'Origin protection and exact loopback/non-hosted restriction; reject unavailable request context.',
});

function walk(root, dir) {
  return readdirSync(resolve(root, dir), { withFileTypes: true }).flatMap(entry => {
    const path = `${dir}/${entry.name}`;
    return entry.isDirectory() ? walk(root, path) : /\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [path] : [];
  });
}
function named(node) { return node?.name && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) ? node.name.text : null; }
const methods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

/** AST discovery deliberately does not classify unknown endpoints. The checked-in
 * manifest must be reviewed when a new method or RPC export is introduced. */
export function discoverEndpoints(root = process.cwd()) {
  const routes = [], functions = [];
  for (const file of walk(root, 'src')) {
    const text = readFileSync(resolve(root, file), 'utf8');
    if (!text.includes('createFileRoute') && !text.includes('createServerFn')) continue;
    const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    let routePath = null;
    const routeMethods = new Set();
    function visit(node) {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'createFileRoute' && ts.isStringLiteral(node.arguments[0])) routePath = node.arguments[0].text;
      if (ts.isPropertyAssignment(node) && named(node) === 'handlers' && ts.isObjectLiteralExpression(node.initializer)) {
        for (const prop of node.initializer.properties) if (methods.has(named(prop))) routeMethods.add(named(prop));
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
    if (routePath && routeMethods.size) routes.push({ file, path: routePath, methods: [...routeMethods].sort() });
    for (const statement of ast.statements) {
      if (!ts.isVariableStatement(statement) || !statement.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
        let method = null;
        function find(node) {
          if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'createServerFn') {
            const options = node.arguments[0];
            if (options && ts.isObjectLiteralExpression(options)) for (const prop of options.properties) if (ts.isPropertyAssignment(prop) && named(prop) === 'method' && ts.isStringLiteral(prop.initializer)) method = prop.initializer.text;
          }
          ts.forEachChild(node, find);
        }
        find(declaration.initializer);
        if (method) functions.push({ file, name: declaration.name.text, method, source: declaration.getText(ast) });
      }
    }
  }
  return { routes: routes.sort((a,b) => a.path.localeCompare(b.path)), functions: functions.sort((a,b) => `${a.file}#${a.name}`.localeCompare(`${b.file}#${b.name}`)) };
}
export function readEndpointInventory(root = process.cwd()) {
  return JSON.parse(readFileSync(resolve(root, 'scripts/security/endpoint-inventory.json'), 'utf8'));
}
export function validateEndpointInventory(root = process.cwd(), inventory = readEndpointInventory(root)) {
  const found = discoverEndpoints(root), problems = [];
  const knownRoutes = new Map(inventory.routes.map(row => [row.path, row]));
  const knownFunctions = new Map(inventory.functions.map(row => [`${row.file}#${row.name}`, row]));
  if (knownRoutes.size !== inventory.routes.length || knownFunctions.size !== inventory.functions.length) problems.push('Duplicate inventory entries.');
  for (const row of found.routes) {
    const known = knownRoutes.get(row.path);
    if (!known) { problems.push(`Unreviewed route ${row.path}`); continue; }
    if (row.file !== known.file || row.methods.join(',') !== known.methods.join(',')) problems.push(`Changed route/method contract ${row.path}`);
    knownRoutes.delete(row.path);
  }
  for (const row of found.functions) {
    const key = `${row.file}#${row.name}`, known = knownFunctions.get(key);
    if (!known) { problems.push(`Unreviewed RPC ${key}`); continue; }
    if (row.method !== known.method) problems.push(`Changed RPC method ${key}`);
    for (const guard of known.requiredInExport ?? []) if (!row.source.includes(guard)) problems.push(`Missing RPC guard ${key}: ${guard}`);
    knownFunctions.delete(key);
  }
  for (const key of knownRoutes.keys()) problems.push(`Removed route still inventoried ${key}`);
  for (const key of knownFunctions.keys()) problems.push(`Removed RPC still inventoried ${key}`);
  for (const row of [...inventory.routes, ...inventory.functions]) {
    if (!ENDPOINT_POLICIES[row.policy] || !row.notes || !row.evidence?.length) problems.push(`Incomplete policy ${row.path ?? row.name}`);
    for (const evidence of row.evidence ?? []) {
      let source;
      try { source = readFileSync(resolve(root, evidence.file), 'utf8'); }
      catch { problems.push(`Missing guard source ${evidence.file}`); continue; }
      for (const marker of evidence.requires ?? []) if (!source.includes(marker)) problems.push(`Missing guard marker ${evidence.file}: ${marker}`);
    }
  }
  return { problems, routeCount: found.routes.length, methodCount: found.routes.reduce((n,r) => n + r.methods.length,0), rpcCount: found.functions.length };
}
export function endpointInventoryMarkdown(root = process.cwd()) {
  const inventory = readEndpointInventory(root), result = validateEndpointInventory(root, inventory);
  const lines = ['# Endpoint authorization inventory (C1-AA060)', '',
    'This checked-in inventory covers every direct route handler and exported TanStack server function discovered from TypeScript AST. A new route, HTTP method, RPC export, removed guard marker or undocumented public exception fails the normal test runner. Guard-source checks establish code reachability contracts; they do not substitute for live penetration testing or prove that a browser/provider/device was exercised.', '',
    `${result.routeCount} routes · ${result.methodCount} HTTP method contracts · ${result.rpcCount} RPC exports.`, '',
    '## Shared policies', '', '| Policy | Contract |', '|---|---|'];
  for (const [key, description] of Object.entries(ENDPOINT_POLICIES)) lines.push(`| ${key} | ${description} |`);
  lines.push('', '## Direct routes', '', '| Route | Methods | Policy | Guard source / ownership boundary |', '|---|---|---|---|');
  for (const row of inventory.routes) lines.push(`| \`${row.path}\` | ${row.methods.join(', ')} | ${row.policy} | ${row.notes} Sources: ${row.evidence.map(e => '`' + e.file + '`').join(', ')} |`);
  lines.push('', '## Server functions', '', '| Export | Method | Policy | Boundary |', '|---|---|---|---|');
  for (const row of inventory.functions) lines.push(`| \`${row.file}#${row.name}\` | ${row.method} | ${row.policy} | ${row.notes} |`);
  lines.push('', '## Verification boundary', '',
    'The inventory test checks the discovered handler surface against explicit policies and required guard call sites. Separate executable fixtures cover request isolation, OAuth state, owner continuity, device credential/job binding, durable halt and dispatch gates. Local-only key copy remains restricted to loopback and unavailable on hosted Vercel. Public manifest verification does not establish account or device authorization. OAuth callbacks retain their single-use state policy and must not be converted to an ordinary same-origin browser mutation.', '',
    'Changes in this branch add missing origin checks to owner pairing mutations and the local PC action route, and add origin-only middleware to credential establishment/sign-out and local key copy. Device-only token routes and OAuth callbacks preserve their distinct guards.', '');
  return lines.join('\n');
}
