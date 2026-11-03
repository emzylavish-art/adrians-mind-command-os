import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildMcpRegistryListPayload,
  resolveMcpListUserId,
  softAuthMcpListDecision,
} from "./mcp-list-auth.ts";
import { loadMcpList } from "./mcp-list-state.ts";
import { pickSessionUser } from "../auth/session-user.ts";

const SAMPLE_SERVERS = [
  { id: "builtin", label: "Built-in", kind: "builtin", enabled: true },
];

/** Mimic getSessionUser using pickSessionUser the same way verify.server does. */
function mockGetSessionUser(input: {
  supabaseUser: { id: string; email: string | null } | null;
  betterAuthUser: { id: string; email: string | null } | null;
}) {
  return pickSessionUser(input);
}

describe("mcp soft-auth with mocked Supabase session", () => {
  it("signed-in Supabase session returns ok plus servers", () => {
    const sessionUser = mockGetSessionUser({
      supabaseUser: { id: "sb-user-1", email: "owner@example.com" },
      betterAuthUser: null,
    });
    const userId = resolveMcpListUserId({
      sessionUser,
      authConfigured: true,
      gateIdentityEnabled: true,
      databaseConfigured: true,
      devUserId: "dev-user",
    });
    assert.equal(userId, "sb-user-1");
    const payload = buildMcpRegistryListPayload(userId, SAMPLE_SERVERS);
    assert.deepEqual(payload, { status: "ok", servers: SAMPLE_SERVERS });
  });

  it("signed-out (no session) returns quiet unauthenticated", () => {
    const sessionUser = mockGetSessionUser({
      supabaseUser: null,
      betterAuthUser: null,
    });
    const userId = resolveMcpListUserId({
      sessionUser,
      authConfigured: true,
      gateIdentityEnabled: true,
      databaseConfigured: true,
      devUserId: "dev-user",
    });
    assert.equal(userId, null);
    assert.deepEqual(buildMcpRegistryListPayload(userId, SAMPLE_SERVERS), {
      status: "unauthenticated",
      servers: [],
    });
  });

  it("invalid or expired Supabase session (null user) returns quiet unauthenticated", () => {
    // getUser() error / expired JWT → readSupabaseSessionUser returns null
    const sessionUser = mockGetSessionUser({
      supabaseUser: null,
      betterAuthUser: null,
    });
    const userId = resolveMcpListUserId({
      sessionUser,
      authConfigured: false,
      gateIdentityEnabled: false,
      databaseConfigured: true, // production DB present → no DEV_USER fallback
      devUserId: "dev-user",
    });
    assert.equal(userId, null);
    assert.equal(buildMcpRegistryListPayload(userId, []).status, "unauthenticated");
  });

  it("Supabase user still wins when Better Auth is disabled (no short-circuit)", () => {
    const sessionUser = mockGetSessionUser({
      supabaseUser: { id: "sb-only", email: null },
      betterAuthUser: null,
    });
    const userId = resolveMcpListUserId({
      sessionUser,
      authConfigured: false,
      gateIdentityEnabled: false,
      databaseConfigured: true,
      devUserId: "dev-user",
    });
    assert.equal(userId, "sb-only");
    assert.equal(buildMcpRegistryListPayload(userId, SAMPLE_SERVERS).status, "ok");
  });

  it("real server error still surfaces as error via loadMcpList (not quiet sign-in)", async () => {
    const state = await loadMcpList(async () => {
      throw new Error("registry blew up");
    });
    assert.equal(state.status, "error");
    assert.notEqual(state.status, "unauthenticated");
  });
});

describe("mcpRegistryList wiring uses shared session helper", () => {
  it("soft-auth handler always calls getSessionUser then resolveMcpListUserId", () => {
    const root = join(import.meta.dirname, "..");
    const server = readFileSync(join(root, "mind/server.ts"), "utf8");
    const start = server.indexOf("export const mcpRegistryList");
    assert.ok(start >= 0);
    const end = server.indexOf("export const mcpRegistryToggle", start);
    const chunk = server.slice(start, end > start ? end : start + 4500);
    assert.match(chunk, /softAuthMcpListDecision/);
    assert.match(chunk, /forceUnauthenticated/);
    assert.match(chunk, /getSessionUser\(context\.bearerToken\)/);
    assert.match(chunk, /resolveMcpListUserId/);
    assert.match(chunk, /buildMcpRegistryListPayload/);
    // Must not short-circuit before getSessionUser when auth is off.
    assert.doesNotMatch(
      chunk,
      /if\s*\(\s*!authConfigured\s*&&\s*!gateIdentityEnabled\(\)\s*\)\s*\{[^}]*DATABASE_URL/,
    );
  });

  it("toggle/tools/call still use authMiddleware → requireUserId → getSessionUser", () => {
    const root = join(import.meta.dirname, "..");
    const server = readFileSync(join(root, "mind/server.ts"), "utf8");
    const middleware = readFileSync(join(root, "auth/middleware.ts"), "utf8");
    const verify = readFileSync(join(root, "auth/verify.server.ts"), "utf8");
    assert.match(server, /export const mcpRegistryToggle[\s\S]*?\.middleware\(\[authMiddleware\]/);
    assert.match(server, /export const mcpRegistryTools[\s\S]*?\.middleware\(\[authMiddleware\]/);
    assert.match(server, /export const mcpRegistryCall[\s\S]*?\.middleware\(\[authMiddleware\]/);
    assert.match(middleware, /requireUserId\(context\.bearerToken\)/);
    assert.match(verify, /readSupabaseSessionUser/);
    assert.match(verify, /pickSessionUser/);
    // Supabase preferred before Better Auth
    const getSessionIdx = verify.indexOf("export async function getSessionUser");
    const body = verify.slice(getSessionIdx, getSessionIdx + 900);
    assert.ok(body.indexOf("readSupabaseSessionUser") < body.indexOf("readBetterAuthSessionUser"));
  });
});


describe("softAuthMcpListDecision", () => {
  it("allows same-origin and missing Sec-Fetch-Site", () => {
    assert.equal(
      softAuthMcpListDecision({ site: "same-origin", mode: "cors", dest: "empty", method: "GET" }),
      "allow",
    );
    assert.equal(
      softAuthMcpListDecision({ site: null, mode: null, dest: null, method: "GET" }),
      "allow",
    );
  });

  it("soft-unauths same-site without our Origin (quiet 200, not 403)", () => {
    assert.equal(
      softAuthMcpListDecision({
        site: "same-site",
        mode: "cors",
        dest: "empty",
        method: "GET",
        origin: null,
        host: "adrians-mind.vercel.app",
      }),
      "soft_unauth",
    );
  });

  it("soft-unauths blocked requests that have no Origin", () => {
    assert.equal(
      softAuthMcpListDecision({
        site: "cross-site",
        mode: "cors",
        dest: "empty",
        method: "GET",
        origin: "",
        host: "adrians-mind.vercel.app",
      }),
      "soft_unauth",
    );
  });

  it("blocks real cross-site foreign Origin", () => {
    assert.equal(
      softAuthMcpListDecision({
        site: "cross-site",
        mode: "cors",
        dest: "empty",
        method: "GET",
        origin: "https://evil.example",
        host: "adrians-mind.vercel.app",
      }),
      "block",
    );
  });
});
