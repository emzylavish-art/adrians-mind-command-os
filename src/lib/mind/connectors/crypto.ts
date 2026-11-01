import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const MIN_SECRET_LEN = 16;

function keyFromSecret(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

export function connectorTokenSecretStatus(
  secret = process.env.CONNECTOR_TOKEN_SECRET,
): { ok: true; secret: string } | { ok: false; error: string } {
  const trimmed = secret?.trim() || "";
  if (!trimmed) {
    return {
      ok: false,
      error: "CONNECTOR_TOKEN_SECRET is not set. Tokens cannot be stored encrypted.",
    };
  }
  if (trimmed.length < MIN_SECRET_LEN) {
    return {
      ok: false,
      error: `CONNECTOR_TOKEN_SECRET is too short (need ≥${MIN_SECRET_LEN} characters). Tokens cannot be stored.`,
    };
  }
  return { ok: true, secret: trimmed };
}

/** Encrypt a token string. Requires CONNECTOR_TOKEN_SECRET (≥16 chars). */
export function encryptSecret(
  plaintext: string,
  secret = process.env.CONNECTOR_TOKEN_SECRET,
): { ciphertext: string; ephemeral: boolean } {
  const status = connectorTokenSecretStatus(secret);
  if (!status.ok) {
    throw new Error(status.error);
  }
  const key = keyFromSecret(status.secret);
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: `${iv.toString("base64url")}.${tag.toString("base64url")}.${enc.toString("base64url")}`,
    ephemeral: false,
  };
}

export function decryptSecret(ciphertext: string, secret = process.env.CONNECTOR_TOKEN_SECRET): string | null {
  const status = connectorTokenSecretStatus(secret);
  if (!status.ok) return null;
  try {
    const [ivB64, tagB64, dataB64] = ciphertext.split(".");
    if (!ivB64 || !tagB64 || !dataB64) return null;
    const key = keyFromSecret(status.secret);
    const decipher = createDecipheriv(ALGO, key, Buffer.from(ivB64, "base64url"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
    const out = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64url")), decipher.final()]);
    return out.toString("utf8");
  } catch {
    return null;
  }
}
