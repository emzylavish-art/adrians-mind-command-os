import { createHash, randomBytes } from "node:crypto";
import { stripControlChars, VCS_CHALLENGE_TTL_MS, VCS_MAX_NAME_CHARS } from "./limits.ts";
import type { ConsentAttestation, ConsentChallenge } from "./types.ts";

/** Fixed preamble the speaker must read; code is appended. */
export const CONSENT_PHRASE_PREFIX =
  "I consent to clone my voice for Adrian's Mind. Confirmation code";

/**
 * Blocklist for profile names / attested identities that look like public figures
 * or third parties (unauthorized impersonation). Lowercase match on normalized name.
 */
export const PUBLIC_FIGURE_BLOCKLIST: readonly string[] = [
  "donald trump",
  "joe biden",
  "barack obama",
  "kamala harris",
  "elon musk",
  "taylor swift",
  "beyonce",
  "beyoncé",
  "oprah winfrey",
  "tom cruise",
  "morgan freeman",
  "james earl jones",
  "scarlett johansson",
  "justin bieber",
  "rihanna",
  "drake",
  "kim kardashian",
  "jeff bezos",
  "mark zuckerberg",
  "bill gates",
  "angela merkel",
  "vladimir putin",
  "xi jinping",
  "pope francis",
  "king charles",
  "queen elizabeth",
  "michael jackson",
  "elvis presley",
  "obama",
  "trump",
  "musk",
];

export function normalizeSpokenText(raw: string): string {
  return stripControlChars(raw)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeProfileName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return stripControlChars(raw).replace(/\s+/g, " ").trim().slice(0, VCS_MAX_NAME_CHARS);
}

export function isBlockedPublicFigureName(name: string): boolean {
  const n = normalizeSpokenText(name);
  if (!n) return false;
  if (PUBLIC_FIGURE_BLOCKLIST.includes(n)) return true;
  // Also block when the name is exactly a blocked token or "voice of X"
  for (const blocked of PUBLIC_FIGURE_BLOCKLIST) {
    if (n === blocked) return true;
    if (n.startsWith(`voice of ${blocked}`)) return true;
    if (n.startsWith(`clone of ${blocked}`)) return true;
    if (n === `${blocked} voice`) return true;
  }
  return false;
}

export function isValidAttestation(value: unknown): value is ConsentAttestation {
  return value === "own_voice" || value === "written_permission";
}

export function generateConsentCode(bytes: () => Buffer = () => randomBytes(4)): string {
  // 8 hex chars → readable code like A1B2C3D4
  return bytes().toString("hex").toUpperCase().slice(0, 8);
}

export function buildConsentPhrase(code: string): string {
  return `${CONSENT_PHRASE_PREFIX} ${code}.`;
}

export function hashConsentPhrase(phrase: string): string {
  return createHash("sha256").update(normalizeSpokenText(phrase), "utf8").digest("hex");
}

export function createConsentChallenge(
  now = Date.now(),
  codeFn: () => string = generateConsentCode,
): ConsentChallenge {
  const code = codeFn();
  const phrase = buildConsentPhrase(code);
  return {
    challengeId: `chs_${randomBytes(12).toString("hex")}`,
    code,
    phrase,
    expiresAt: new Date(now + VCS_CHALLENGE_TTL_MS).toISOString(),
  };
}

/**
 * Verify STT transcript covers the consent phrase + exact code.
 * Requires the code and key consent words; rejects empty / mismatched.
 */
export function verifyConsentTranscript(input: {
  transcript: string;
  expectedCode: string;
  expectedPhrase: string;
}): { ok: true } | { ok: false; error: string } {
  const got = normalizeSpokenText(input.transcript);
  if (!got) {
    return { ok: false, error: "Consent audio had no recognizable words. Record the consent phrase and try again." };
  }
  const code = normalizeSpokenText(input.expectedCode);
  if (!code || !got.includes(code.toLowerCase())) {
    return {
      ok: false,
      error: "Consent phrase did not include the required confirmation code. Read the full phrase and try again.",
    };
  }
  // Require core words so a code-only utterance cannot pass.
  const need = ["consent", "clone", "voice", "adrian", "mind"];
  for (const word of need) {
    if (!got.includes(word)) {
      return {
        ok: false,
        error: "Consent phrase did not match. Read the exact consent sentence including the confirmation code.",
      };
    }
  }
  const expectedNorm = normalizeSpokenText(input.expectedPhrase);
  // Soft check: expected phrase tokens should mostly appear (STT may drop a word).
  const expectedTokens = expectedNorm.split(" ").filter(Boolean);
  const hit = expectedTokens.filter((t) => got.includes(t)).length;
  if (hit < Math.ceil(expectedTokens.length * 0.7)) {
    return {
      ok: false,
      error: "Consent phrase did not match closely enough. Read the exact sentence and try again.",
    };
  }
  return { ok: true };
}
