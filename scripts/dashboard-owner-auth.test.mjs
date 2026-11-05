import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const owner = readFileSync("src/lib/mind/dashboard/owner.server.ts", "utf8");
const page = readFileSync("src/lib/mind/dashboard/require-dashboard-user.ts", "utf8");
const api = readFileSync("src/routes/api/mind/dashboard/status.ts", "utf8");

describe("Mind owner authorization contract", () => {
  it("fails closed on absent configuration and compares opaque IDs exactly", () => {
    assert.match(owner, /process\.env\.MIND_OWNER_USER_ID/);
    assert.match(owner, /userId\s*===\s*configuredOwnerId\.trim\(\)/);
    assert.match(owner, /configuredOwnerId\.trim\(\)\.length\s*===\s*0/);
    assert.doesNotMatch(owner, /email|VITE_|fallback/i);
  });
  it("preserves signed-out redirect and gates dashboard before returning data", () => {
    assert.ok(page.indexOf("if (!user)") < page.indexOf("isMindOwnerId(user.id)"));
    assert.ok(page.indexOf("isMindOwnerId(user.id)") < page.indexOf("return { sessionUser"));
    assert.match(page, /new Response\("Forbidden", \{ status: 403 \}\)/);
  });
  it("gates status before the builder and retains no-store", () => {
    assert.ok(api.indexOf("requireUserId(bearer)") < api.indexOf("isMindOwnerId(userId)"));
    assert.ok(api.indexOf("isMindOwnerId(userId)") < api.indexOf("buildDashboardStatus()"));
    assert.match(api, /json\(\{ ok: false, error: "Forbidden\." \}, 403\)/);
    assert.match(api, /"cache-control": "no-store"/);
  });
});
