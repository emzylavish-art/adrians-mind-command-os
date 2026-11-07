import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { vercelRuntimeHosts } from './runtime-origins.ts';
describe('Vercel runtime hosts', () => {
  it('uses exact deployment/branch hosts, lowercases and deduplicates', () => {
    assert.deepEqual(vercelRuntimeHosts({VERCEL_URL:'Preview-1.vercel.app',VERCEL_BRANCH_URL:'branch.vercel.app'}), ['preview-1.vercel.app','branch.vercel.app']);
    assert.deepEqual(vercelRuntimeHosts({VERCEL_URL:'a.vercel.app',VERCEL_BRANCH_URL:'A.vercel.app'}), ['a.vercel.app']);
  });
  it('rejects arbitrary origins, wildcards, scheme, ports, paths, whitespace, IP and injection', () => {
    for (const bad of ['https://a.vercel.app','*.vercel.app','a.vercel.app:443','a.vercel.app/path','a.vercel.app?x','a.vercel.app@evil.com','a.vercel.app\n','a..vercel.app','-a.vercel.app','a-.vercel.app','a.vercel.app.evil.com','127.0.0.1','a\\b.vercel.app']) assert.deepEqual(vercelRuntimeHosts({VERCEL_URL:bad}), [], bad);
  });
});
