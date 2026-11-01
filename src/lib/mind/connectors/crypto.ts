import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";

function keyFromSecret(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

/** Encrypt a token string. Uses CONNECTOR_TOKEN_SECRET when set; otherwise a process-local ephemeral key (tokens do not survive restart). */
export function encryptSecret(plaintext: string, secret = process.env.CONNECTOR_TOKEN_SECRET): { ciphertext: string; ephemeral: boolean } {
  const ephemeral = !secret?.trim();
  const key = keyFromSecret(secret?.trim() || `ephemeral:${process.pid}:${process.env.USER || "box"}`);
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: `${iv.toString("base64url")}.${tag.toString("base64url")}.${enc.toString("base64url")}`,
    ephemeral,
  };
}

export function decryptSecret(ciphertext: string, secret = process.env.CONNECTOR_TOKEN_SECRET): string | null {
  try {
    const [ivB64, tagB64, dataB64] = ciphertext.split(".");
    if (!ivB64 || !tagB64 || !dataB64) return null;
    const ephemeral = !secret?.trim();
    const key = keyFromSecret(secret?.trim() || `ephemeral:${process.pid}:${process.env.USER || "box"}`);
    const decipher = createDecipheriv(ALGO, key, Buffer.from(ivB64, "base64url"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
    const out = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64url")), decipher.final()]);
    return out.toString("utf8");
  } catch {
    return null;
  }
}
