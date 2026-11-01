import { readManagementKey } from "./management-key.ts";
import { hmacHex, randomPairingCode, randomToken, safeEqualHex, sha256Hex } from "./crypto.ts";
import {
  newId,
  pruneStore,
  readPairingStore,
  writePairingStore,
  type DeviceRecord,
} from "./store.ts";
import { DEVICE_SCOPES } from "./scope.ts";

export const PAIRING_CODE_TTL_MS = 5 * 60 * 1000;
export const DEVICE_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
export const HEARTBEAT_FRESH_MS = 2 * 60 * 1000;

function codeMac(managementKey: string, code: string, userId: string, expiresAt: string): string {
  return hmacHex(managementKey, `pairing-code|${userId}|${code}|${expiresAt}`);
}

export function mintPairingCode(userId: string, now = Date.now()):
  | { ok: true; code: string; expiresAt: string; id: string }
  | { ok: false; error: string } {
  const key = readManagementKey();
  if (!key.ok) return key;
  const code = randomPairingCode();
  const expiresAt = new Date(now + PAIRING_CODE_TTL_MS).toISOString();
  const mac = codeMac(key.key, code, userId, expiresAt);
  const record = {
    id: newId("code"),
    codeHash: sha256Hex(`${code}|${mac}`),
    userId,
    createdAt: new Date(now).toISOString(),
    expiresAt,
    usedAt: null as string | null,
  };
  const store = pruneStore(readPairingStore(), now);
  store.codes.push(record);
  writePairingStore(store);
  return { ok: true, code, expiresAt, id: record.id };
}

export function exchangePairingCode(input: {
  code: string;
  publicKeyPem: string;
  deviceName: string;
  now?: number;
}):
  | {
      ok: true;
      deviceId: string;
      token: string;
      tokenId: string;
      scopes: string[];
      expiresAt: string;
    }
  | { ok: false; error: string } {
  const now = input.now ?? Date.now();
  const key = readManagementKey();
  if (!key.ok) return key;
  const code = input.code.trim().toUpperCase();
  if (!code) return { ok: false, error: "Pairing code is required." };
  if (!input.publicKeyPem?.includes("PUBLIC KEY")) {
    return { ok: false, error: "A device public key is required." };
  }
  const name = (input.deviceName || "HP EliteBook").trim().slice(0, 80);
  const store = pruneStore(readPairingStore(), now);

  let matched: (typeof store.codes)[number] | null = null;
  for (const record of store.codes) {
    if (record.usedAt) continue;
    if (Date.parse(record.expiresAt) <= now) continue;
    const mac = codeMac(key.key, code, record.userId, record.expiresAt);
    const hash = sha256Hex(`${code}|${mac}`);
    if (safeEqualHex(hash, record.codeHash)) {
      matched = record;
      break;
    }
  }
  if (!matched) {
    // Distinguish expired/reused vs wrong without leaking which codes exist.
    const anySameShape = store.codes.some((record) => {
      const mac = codeMac(key.key, code, record.userId, record.expiresAt);
      return safeEqualHex(sha256Hex(`${code}|${mac}`), record.codeHash);
    });
    if (anySameShape) {
      const again = store.codes.find((record) => {
        const mac = codeMac(key.key, code, record.userId, record.expiresAt);
        return safeEqualHex(sha256Hex(`${code}|${mac}`), record.codeHash);
      })!;
      if (again.usedAt) return { ok: false, error: "Pairing code was already used." };
      if (Date.parse(again.expiresAt) <= now) return { ok: false, error: "Pairing code expired." };
    }
    return { ok: false, error: "Pairing code is invalid." };
  }

  matched.usedAt = new Date(now).toISOString();
  const token = randomToken(32);
  const tokenId = newId("tok");
  const deviceId = newId("dev");
  const expiresAt = new Date(now + DEVICE_TOKEN_TTL_MS).toISOString();
  const device: DeviceRecord = {
    id: deviceId,
    userId: matched.userId,
    name,
    publicKeyPem: input.publicKeyPem.trim(),
    tokenHash: sha256Hex(token),
    tokenId,
    scopes: [...DEVICE_SCOPES],
    createdAt: new Date(now).toISOString(),
    expiresAt,
    revokedAt: null,
    lastHeartbeatAt: new Date(now).toISOString(),
    emergencyStopped: false,
    emergencyStoppedAt: null,
    emergencyStoppedBy: null,
  };
  store.devices.push(device);
  writePairingStore(store);
  return {
    ok: true,
    deviceId,
    token,
    tokenId,
    scopes: device.scopes,
    expiresAt,
  };
}

export function findDeviceByToken(token: string, now = Date.now()):
  | { ok: true; device: DeviceRecord }
  | { ok: false; error: string } {
  if (!token) return { ok: false, error: "Device token is required." };
  const store = readPairingStore();
  const hash = sha256Hex(token);
  const device = store.devices.find((d) => safeEqualHex(d.tokenHash, hash));
  if (!device) return { ok: false, error: "Device token is invalid." };
  if (device.revokedAt) return { ok: false, error: "Device token was revoked." };
  if (Date.parse(device.expiresAt) <= now) return { ok: false, error: "Device token expired." };
  return { ok: true, device };
}

export function rotateDeviceToken(token: string, now = Date.now()):
  | { ok: true; token: string; tokenId: string; expiresAt: string }
  | { ok: false; error: string } {
  const found = findDeviceByToken(token, now);
  if (!found.ok) return found;
  const store = readPairingStore();
  const device = store.devices.find((d) => d.id === found.device.id);
  if (!device) return { ok: false, error: "Device not found." };
  const next = randomToken(32);
  device.tokenHash = sha256Hex(next);
  device.tokenId = newId("tok");
  device.expiresAt = new Date(now + DEVICE_TOKEN_TTL_MS).toISOString();
  writePairingStore(store);
  return { ok: true, token: next, tokenId: device.tokenId, expiresAt: device.expiresAt };
}
