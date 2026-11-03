/**
 * Password-reset helpers (pure). ServerFns call Supabase; the browser never
 * talks to *.supabase.co — same pattern as email sign-in.
 */

export const PASSWORD_RESET_PATH = "/auth/reset";
export const PASSWORD_FORGOT_PATH = "/auth/forgot";

/** Canonical prod redirect used in reset emails + Auth allowlist. */
export const PASSWORD_RESET_REDIRECT =
  "https://adrians-mind.vercel.app/auth/reset";

/** Neutral copy — never confirms whether the email has an account. */
export const PASSWORD_RESET_REQUEST_NEUTRAL =
  "If an account exists for that email, a reset link is on its way. Check your inbox and spam folder.";

export const PASSWORD_RESET_INVALID_LINK =
  "This reset link is invalid or has expired. Request a new one from the sign-in page.";

export const PASSWORD_MIN_LENGTH = 8;

export type PasswordResetSearch = {
  tokenHash: string;
  type: string;
  code: string;
  error: string;
};

export function parsePasswordResetSearch(
  search: Record<string, unknown> | null | undefined,
): PasswordResetSearch {
  const s = search ?? {};
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const v = s[key];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return "";
  };
  return {
    tokenHash: pick("token_hash", "tokenHash").slice(0, 512),
    type: pick("type").slice(0, 32) || "recovery",
    code: pick("code").slice(0, 512),
    error: pick("error_description", "error").slice(0, 240),
  };
}

export function buildFirstPartyResetUrl(input: {
  origin?: string;
  tokenHash: string;
  type?: string;
}): string {
  const base = (input.origin?.replace(/\/$/, "") ||
    "https://adrians-mind.vercel.app") + PASSWORD_RESET_PATH;
  const url = new URL(base);
  url.searchParams.set("token_hash", input.tokenHash);
  url.searchParams.set("type", input.type || "recovery");
  return url.toString();
}

export function validateNewPassword(password: string): {
  ok: true;
} | { ok: false; error: string } {
  const value = typeof password === "string" ? password : "";
  if (value.length < PASSWORD_MIN_LENGTH) {
    return {
      ok: false,
      error: `Use a password with at least ${PASSWORD_MIN_LENGTH} characters.`,
    };
  }
  if (value.length > 200) {
    return { ok: false, error: "That password is too long." };
  }
  return { ok: true };
}

export function canSubmitPasswordReset(input: {
  tokenHash: string;
  code: string;
  password: string;
}): boolean {
  const hasProof = Boolean(input.tokenHash || input.code);
  return hasProof && validateNewPassword(input.password).ok;
}

/** Map generateLink recovery properties → first-party URL (tests / admin path). */
export function firstPartyUrlFromGenerateLink(input: {
  hashedToken?: string | null;
  redirectTo?: string | null;
}): string | null {
  const token = typeof input.hashedToken === "string" ? input.hashedToken.trim() : "";
  if (!token) return null;
  let origin: string | undefined;
  if (input.redirectTo) {
    try {
      origin = new URL(input.redirectTo).origin;
    } catch {
      origin = undefined;
    }
  }
  return buildFirstPartyResetUrl({ origin, tokenHash: token });
}
