/**
 * Mocked end-to-end auth flow (no real Supabase project):
 * sign-up → session cookie → gate allow → sign-out clears → gate redirects.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decideDashboardGate, type SupabaseGateUser } from "./gate.ts";
import {
  mergeCookieOptions,
  requiredAuthCookieShape,
} from "./cookies.ts";
import { resolveSupabaseEnv } from "./env.ts";
import { buildAuthCallbackUrl } from "./oauth-redirect.ts";
import { safeRedirectPath } from "./safe-redirect.ts";

type CookieRecord = {
  name: string;
  value: string;
  options: Record<string, unknown>;
};

/** Minimal in-memory jar mimicking Supabase SSR setAll/getAll + signOut clear. */
class MockSessionJar {
  private store = new Map<string, CookieRecord>();

  setAll(cookies: CookieRecord[]) {
    for (const cookie of cookies) {
      const merged = mergeCookieOptions(cookie.options, true);
      if (!cookie.value) {
        this.store.delete(cookie.name);
        continue;
      }
      this.store.set(cookie.name, { ...cookie, options: merged });
    }
  }

  getAll() {
    return [...this.store.values()].map(({ name, value }) => ({ name, value }));
  }

  clearAuth() {
    for (const name of [...this.store.keys()]) {
      if (name.includes("auth-token") || name.startsWith("sb-")) {
        this.store.delete(name);
      }
    }
  }

  records() {
    return [...this.store.values()];
  }
}

type MockUser = SupabaseGateUser & { password: string };

class MockSupabaseAuth {
  users = new Map<string, MockUser>();
  sessions = new Map<string, string>(); // token -> userId
  jar: MockSessionJar;

  constructor(jar: MockSessionJar) {
    this.jar = jar;
  }

  private writeSession(userId: string) {
    const token = `tok_${userId}_${this.sessions.size + 1}`;
    this.sessions.set(token, userId);
    this.jar.setAll([
      {
        name: "sb-access-token",
        value: token,
        options: { path: "/", maxAge: 3600 },
      },
      {
        name: "sb-auth-token",
        value: JSON.stringify({ access_token: token, user: { id: userId } }),
        options: { path: "/" },
      },
    ]);
    return token;
  }

  signUp(email: string, password: string) {
    if (password.length < 8) {
      return { ok: false as const, error: "password too short" };
    }
    const id = `user_${this.users.size + 1}`;
    this.users.set(email, { id, email, password });
    this.writeSession(id);
    return { ok: true as const, user: { id, email } };
  }

  signIn(email: string, password: string) {
    const user = this.users.get(email);
    if (!user || user.password !== password) {
      return { ok: false as const, error: "Invalid login credentials" };
    }
    this.writeSession(user.id);
    return { ok: true as const, user: { id: user.id, email: user.email } };
  }

  currentUser(): SupabaseGateUser | null {
    const cookies = this.jar.getAll();
    const tokenCookie = cookies.find((c) => c.name === "sb-access-token");
    if (!tokenCookie) return null;
    const userId = this.sessions.get(tokenCookie.value);
    if (!userId) return null;
    for (const user of this.users.values()) {
      if (user.id === userId) return { id: user.id, email: user.email };
    }
    return null;
  }

  signOut() {
    this.jar.clearAuth();
    // Also wipe session map entries that match cleared tokens
    this.sessions.clear();
  }

  /** Mimic OAuth callback exchangeCodeForSession. */
  exchangeCode(code: string) {
    if (code !== "valid-code") {
      return { ok: false as const, error: "invalid code" };
    }
    const email = "oauth@example.com";
    let user = this.users.get(email);
    if (!user) {
      user = { id: "user_oauth", email, password: "" };
      this.users.set(email, user);
    }
    this.writeSession(user.id);
    return { ok: true as const, user: { id: user.id, email: user.email } };
  }
}

function gateFromAuth(auth: MockSupabaseAuth, configured: boolean) {
  return decideDashboardGate({
    configured,
    user: configured ? auth.currentUser() : null,
  });
}

describe("mocked auth flow", () => {
  it("sign-up → cookie set → gate passes → sign-out clears → gate redirects", () => {
    const env = resolveSupabaseEnv({
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_ANON_KEY: "anon-test",
    });
    assert.ok(env);

    const jar = new MockSessionJar();
    const auth = new MockSupabaseAuth(jar);

    assert.deepEqual(gateFromAuth(auth, true), {
      action: "redirect_login",
      reason: "no_user",
    });

    const signedUp = auth.signUp("owner@example.com", "password1");
    assert.equal(signedUp.ok, true);
    const cookiesAfterSignUp = jar.getAll();
    assert.ok(cookiesAfterSignUp.some((c) => c.name === "sb-access-token"));
    assert.equal(
      cookiesAfterSignUp.find((c) => c.name === "sb-access-token")?.value.startsWith("tok_"),
      true,
    );
    // Security shape on written cookies
    const written = jar.records()[0];
    assert.equal(written.options.httpOnly, true);
    assert.equal(written.options.sameSite, "lax");
    assert.equal(written.options.secure, true);
    assert.deepEqual(requiredAuthCookieShape(true).httpOnly, true);

    assert.deepEqual(gateFromAuth(auth, true), {
      action: "allow",
      user: { id: "user_1", email: "owner@example.com" },
    });

    auth.signOut();
    assert.equal(jar.getAll().length, 0);
    assert.deepEqual(gateFromAuth(auth, true), {
      action: "redirect_login",
      reason: "no_user",
    });
  });

  it("sign-in reuses the account and OAuth callback sets cookies", () => {
    const jar = new MockSessionJar();
    const auth = new MockSupabaseAuth(jar);
    assert.equal(auth.signUp("a@b.co", "password1").ok, true);
    auth.signOut();

    const signedIn = auth.signIn("a@b.co", "password1");
    assert.equal(signedIn.ok, true);
    assert.equal(gateFromAuth(auth, true).action, "allow");

    auth.signOut();
    const oauth = auth.exchangeCode("valid-code");
    assert.equal(oauth.ok, true);
    assert.equal(gateFromAuth(auth, true).action, "allow");
    assert.equal(
      (gateFromAuth(auth, true) as { user: SupabaseGateUser }).user.email,
      "oauth@example.com",
    );

    const bad = auth.exchangeCode("nope");
    assert.equal(bad.ok, false);
  });

  it("fails closed when env is missing even if a cookie jar has tokens", () => {
    const jar = new MockSessionJar();
    const auth = new MockSupabaseAuth(jar);
    auth.signUp("x@y.z", "password1");
    assert.deepEqual(gateFromAuth(auth, false), {
      action: "redirect_login",
      reason: "missing_env",
    });
  });

  it("OAuth redirectTo is origin-relative for preview URLs", () => {
    const preview =
      "https://adrians-mind-abc123-team.vercel.app";
    const redirectTo = buildAuthCallbackUrl(preview, safeRedirectPath("/dashboard"));
    assert.equal(
      redirectTo,
      `${preview}/auth/callback?next=%2Fdashboard`,
    );
    assert.ok(!redirectTo.includes("adrians-mind.vercel.app/auth"));
  });
});

describe("password reset first-party contract", () => {
  it("reset redirect targets Adrian's Mind, never supabase.co", async () => {
    const { PASSWORD_RESET_REDIRECT, buildFirstPartyResetUrl, firstPartyUrlFromGenerateLink } =
      await import("./password-reset.ts");
    assert.equal(
      PASSWORD_RESET_REDIRECT,
      "https://adrians-mind.vercel.app/auth/reset",
    );
    assert.ok(!PASSWORD_RESET_REDIRECT.includes("supabase.co"));
    const fromLink = firstPartyUrlFromGenerateLink({
      hashedToken: "recovery_hash",
      redirectTo: PASSWORD_RESET_REDIRECT,
    });
    assert.equal(
      fromLink,
      buildFirstPartyResetUrl({ tokenHash: "recovery_hash" }),
    );
    assert.ok(fromLink && !fromLink.includes("supabase.co"));
  });
});
