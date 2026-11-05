import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe,it } from 'node:test';
const owner=readFileSync('src/lib/mind/dashboard/owner.server.ts','utf8');
const page=readFileSync('src/lib/mind/dashboard/require-dashboard-user.ts','utf8');
const api=readFileSync('src/routes/api/mind/dashboard/status.ts','utf8');
describe('owner auth source contract',()=>{
 it('uses private env and fails closed',()=>{assert.match(owner,/process\.env\.MIND_OWNER_USER_ID/);assert.match(owner,/userId === configuredOwnerId\.trim\(\)/);assert.match(owner,/configuredOwnerId\.trim\(\)\.length === 0/);assert.doesNotMatch(owner,/email|VITE_|fallback/i)});
 it('preserves signin redirect and gates the page',()=>{assert.ok(page.indexOf('if (!user)')<page.indexOf('isMindOwnerId(user.id)'));assert.ok(page.indexOf('isMindOwnerId(user.id)')<page.indexOf('return { sessionUser'));assert.match(page,/new Response\("Forbidden", \{ status: 403 \}\)/)});
 it('gates status before builder and no-store',()=>{assert.ok(api.indexOf('requireUserId(bearer)')<api.indexOf('isMindOwnerId(userId)'));assert.ok(api.indexOf('isMindOwnerId(userId)')<api.indexOf('buildDashboardStatus()'));assert.match(api,/json\(\{ ok: false, error: "Forbidden\." \}, 403\)/);assert.match(api,/"cache-control": "no-store"/)})
});
