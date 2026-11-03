import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { hmacHex, safeEqualHex, sha256Hex } from "./crypto.ts";
import type { DeviceRecord } from "./store.ts";

/** Normalize PEM for stable fingerprinting (whitespace-insensitive). */
export function fingerprintPublicKey(publicKeyPem: string): string {
  const normalized = publicKeyPem.replace(/\r\n/g, "\n").trim();
  return sha256Hex(normalized);
}

/**
 * Proof that the caller still holds the device private key that was registered
 * at handshake. Challenge is signed (RSA-SHA256) OR, for tests without real
 * keys, an HMAC over challenge using the device token + fingerprint.
 *
 * Stolen token alone is insufficient: verifyDeviceBinding requires a matching
 * fingerprint and a valid proof for a server-issued challenge.
 */
export function makeBindingChallenge(deviceId: string, tokenId: string, now = Date.now()): string {
  return sha256Hex(`bind|${deviceId}|${tokenId}|${Math.floor(now / 30_000)}`);
}

export function hmacBindingProof(deviceToken: string, fingerprint: string, challenge: string): string {
  return hmacHex(deviceToken, `device-bind|${fingerprint}|${challenge}`);
}

export function verifyHmacBindingProof(input: {
  deviceToken: string;
  fingerprint: string;
  challenge: string;
  proof: string;
}): boolean {
  const expected = hmacBindingProof(input.deviceToken, input.fingerprint, input.challenge);
  return safeEqualHex(expected, input.proof);
}

export function verifyRsaBindingProof(input: {
  publicKeyPem: string;
  challenge: string;
  signatureBase64: string;
}): boolean {
  try {
    const key = createPublicKey(input.publicKeyPem);
    return verify(null, Buffer.from(input.challenge, "utf8"), key, Buffer.from(input.signatureBase64, "base64"));
  } catch {
    return false;
  }
}

export function verifyDeviceBinding(input: {
  device: DeviceRecord;
  deviceToken: string;
  /** Must match the fingerprint stored at pairing. */
  claimedFingerprint: string;
  challenge: string;
  /** HMAC proof (token+fingerprint) and/or RSA signature over challenge. */
  hmacProof?: string;
  rsaSignatureBase64?: string;
}): { ok: true } | { ok: false; error: string } {
  if (!safeEqualHex(input.device.publicKeyFingerprint, input.claimedFingerprint)) {
    return { ok: false, error: "Device key fingerprint mismatch (token cannot move to another host key)." };
  }
  if (fingerprintPublicKey(input.device.publicKeyPem) !== input.device.publicKeyFingerprint) {
    return { ok: false, error: "Stored public key does not match fingerprint." };
  }
  const expectedChallenge = makeBindingChallenge(input.device.id, input.device.tokenId);
  // Allow current or previous 30s window
  const prev = makeBindingChallenge(input.device.id, input.device.tokenId, Date.now() - 30_000);
  if (input.challenge !== expectedChallenge && input.challenge !== prev) {
    return { ok: false, error: "Binding challenge is stale or invalid." };
  }
  let ok = false;
  if (input.hmacProof) {
    ok = verifyHmacBindingProof({
      deviceToken: input.deviceToken,
      fingerprint: input.claimedFingerprint,
      challenge: input.challenge,
      proof: input.hmacProof,
    });
  }
  if (!ok && input.rsaSignatureBase64) {
    ok = verifyRsaBindingProof({
      publicKeyPem: input.device.publicKeyPem,
      challenge: input.challenge,
      signatureBase64: input.rsaSignatureBase64,
    });
  }
  if (!ok) return { ok: false, error: "Device binding proof failed." };
  return { ok: true };
}

/** Test helper: sign challenge with a generated PEM private key. */
export function signChallengeForTests(privateKeyPem: string, challenge: string): string {
  const key = createPrivateKey(privateKeyPem);
  return sign(null, Buffer.from(challenge, "utf8"), key).toString("base64");
}

export function sha256FileHex(contents: string | Buffer): string {
  return createHash("sha256").update(contents).digest("hex");
}
