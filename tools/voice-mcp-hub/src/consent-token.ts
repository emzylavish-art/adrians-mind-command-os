/**
 * Studio issues short-lived consent tokens; the hub verifies HMAC before create_voice.
 * Shared secret: VOICE_HUB_CONSENT_SECRET (dev fallback is process-local and not for prod).
 */
import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";

export type ConsentTokenPayload = {
  consentRecordId: string;
  userId: string;
  profileId?: string;
  exp: number;
};

function secret(env: Record<string, string | undefined> = process.env): string {
  return (env.VOICE_HUB_CONSENT_SECRET || env.CONNECTOR_TOKEN_SECRET || "dev-only-voice-hub-consent").slice(0, 128);
}

export function issueConsentToken(
  payload: Omit<ConsentTokenPayload, "exp"> & { ttlMs?: number },
  env: Record<string, string | undefined> = process.env,
  now = Date.now(),
): string {
  const body: ConsentTokenPayload = {
    consentRecordId: payload.consentRecordId,
    userId: payload.userId,
    profileId: payload.profileId,
    exp: now + (payload.ttlMs ?? 15 * 60_000),
  };
  const json = Buffer.from(JSON.stringify(body)).toString("base64url");
  const sig = createHmac("sha256", secret(env)).update(json).digest("base64url");
  return `${json}.${sig}`;
}

export function verifyConsentToken(
  token: string,
  expectedConsentRecordId: string,
  env: Record<string, string | undefined> = process.env,
  now = Date.now(),
): { ok: true; payload: ConsentTokenPayload } | { ok: false; error: string } {
  if (typeof token !== "string" || !token.includes(".")) {
    return { ok: false, error: "Missing consent token. Studio must issue one after verified consent." };
  }
  const [json, sig] = token.split(".", 2);
  if (!json || !sig) return { ok: false, error: "Malformed consent token." };
  const expected = createHmac("sha256", secret(env)).update(json).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, error: "Consent token signature invalid." };
  }
  let payload: ConsentTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(json, "base64url").toString("utf8")) as ConsentTokenPayload;
  } catch {
    return { ok: false, error: "Consent token payload unreadable." };
  }
  if (!payload.consentRecordId || payload.consentRecordId !== expectedConsentRecordId) {
    return { ok: false, error: "Consent token does not match consent record id." };
  }
  if (typeof payload.exp !== "number" || payload.exp < now) {
    return { ok: false, error: "Consent token expired. Re-verify consent in the Studio." };
  }
  return { ok: true, payload };
}

export function newConsentRecordId(): string {
  return `vcc_${randomBytes(12).toString("hex")}`;
}
