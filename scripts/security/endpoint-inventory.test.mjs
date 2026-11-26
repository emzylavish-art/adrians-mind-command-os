import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { discoverEndpoints, ENDPOINT_POLICIES, endpointInventoryMarkdown, readEndpointInventory, validateEndpointInventory } from './endpoint-inventory.mjs';
import { assertSameOrigin } from '../../src/lib/mind/connectors/oauth-csrf.ts';
import { decideRequestIsolation } from '../../src/lib/mind/request-guard.ts';

const root = resolve(import.meta.dirname, '../..');
test('AA060 every HTTP method and RPC export has an explicit guard contract', () => {
  const result = validateEndpointInventory(root);
  assert.deepEqual(result.problems, []);
  assert.ok(result.routeCount >= 72);
  assert.ok(result.methodCount >= 104);
  assert.ok(result.rpcCount >= 58);
  assert.equal(readFileSync(resolve(root, 'docs/verification/endpoint-security.md'), 'utf8'), endpointInventoryMarkdown(root));
});
test('AA060 a newly introduced or changed endpoint fails until the contract is reviewed', () => {
  const manifest = readEndpointInventory(root);
  const omitted = structuredClone(manifest);
  const row = omitted.routes.pop();
  assert.ok(validateEndpointInventory(root, omitted).problems.includes(`Unreviewed route ${row.path}`));
  const changed = structuredClone(manifest);
  changed.routes[0].methods.push('PATCH');
  assert.ok(validateEndpointInventory(root, changed).problems.some(p => p.startsWith('Changed route/method contract')));
  const unguarded = structuredClone(manifest);
  unguarded.functions[0].requiredInExport.push('REQUIRED_GUARD_IS_MISSING');
  assert.ok(validateEndpointInventory(root, unguarded).problems.some(p => p.includes('REQUIRED_GUARD_IS_MISSING')));
});
test('AA060 browser mutation policies reject hostile origins while device and callback categories remain distinct', () => {
  for (const site of ['cross-site', 'same-site']) {
    const request = new Request('https://mind.example/api/mind/pc/status', { method: 'POST', headers: { 'sec-fetch-site': site, origin: 'https://sibling.example' } });
    assert.equal(assertSameOrigin(request).ok, false);
    assert.equal(decideRequestIsolation(request), 'block');
  }
  const same = new Request('https://mind.example/api/mind/pc/status', { method: 'POST', headers: { 'sec-fetch-site': 'same-origin', origin: 'https://mind.example' } });
  assert.equal(assertSameOrigin(same).ok, true);
  const native = new Request('https://mind.example/api/mind/pc/jobs', { method: 'POST', headers: { authorization: 'Bearer synthetic-device-token' } });
  assert.equal(assertSameOrigin(native).ok, true); // Token/job authentication remains independently mandatory.
  const rows = readEndpointInventory(root).routes;
  assert.equal(rows.find(r => r.path === '/api/mind/pc/jobs').policy, 'paired_device');
  assert.equal(rows.find(r => r.path === '/api/mind/oauth/notion/callback').policy, 'oauth_callback');
  assert.notEqual(ENDPOINT_POLICIES.paired_device, ENDPOINT_POLICIES.owner_origin);
});
test('AA060 owner mutation guards run before identity resolution or request body consumption', () => {
  const pairing = readFileSync(resolve(root, 'src/lib/mind/pairing/pairing.server.ts'), 'utf8');
  for (const name of ['handleMintPairingCode', 'handleSignAction', 'handleEmergencyStop', 'handleClearEmergencyStop']) {
    const body = pairing.slice(pairing.indexOf(`export async function ${name}`)).split(/\nexport async function /)[0];
    const guard = body.indexOf('assertSameOrigin(request)'), denial = body.indexOf('if (!origin.ok)');
    assert.ok(guard >= 0 && denial > guard, name);
    for (const mutationBoundary of ['requireUserId(', 'readJson(request)']) {
      const boundary = body.indexOf(mutationBoundary);
      if (boundary >= 0) assert.ok(denial < boundary, `${name}: ${mutationBoundary}`);
    }
  }
  const pc = readFileSync(resolve(root, 'src/routes/api/mind/pc/status.ts'), 'utf8').split('POST: async')[1];
  assert.ok(pc.indexOf('assertSameOrigin(request)') < pc.indexOf('requireUserId('));
  const functions = discoverEndpoints(root).functions;
  for (const name of ['signInWithPassword', 'signUpWithPassword', 'startOAuth', 'signOutSupabase', 'copyOwnerKeyFn']) {
    assert.ok(functions.find(row => row.name === name).source.includes('.middleware([isolationMiddleware])'), name);
  }
});
