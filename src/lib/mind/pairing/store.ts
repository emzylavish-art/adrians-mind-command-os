import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

export type PairingCodeRecord = {
  id: string;
  codeHash: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
};

export type DeviceRecord = {
  id: string;
  userId: string;
  name: string;
  publicKeyPem: string;
  tokenHash: string;
  tokenId: string;
  scopes: string[];
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  lastHeartbeatAt: string | null;
  emergencyStopped: boolean;
  emergencyStoppedAt: string | null;
  emergencyStoppedBy: string | null;
};

export type ActionReport = {
  id: string;
  deviceId: string;
  actionId: string;
  kind: string;
  outcome: "success" | "failure" | "rejected";
  detail: string;
  at: string;
};

export type UsedNonce = { nonce: string; actionId: string; at: string };

export type PairingStore = {
  codes: PairingCodeRecord[];
  devices: DeviceRecord[];
  reports: ActionReport[];
  usedNonces: UsedNonce[];
};

let directory = join(process.cwd(), ".data", "mind-pairing");

export function setPairingStoreDirectory(next: string) {
  directory = next;
}

export function pairingStoreDirectory(): string {
  return directory;
}

function storePath() {
  return join(directory, "store.json");
}

function emptyStore(): PairingStore {
  return { codes: [], devices: [], reports: [], usedNonces: [] };
}

export function readPairingStore(): PairingStore {
  try {
    const raw = readFileSync(storePath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<PairingStore>;
    return {
      codes: Array.isArray(parsed.codes) ? parsed.codes : [],
      devices: Array.isArray(parsed.devices) ? parsed.devices : [],
      reports: Array.isArray(parsed.reports) ? parsed.reports : [],
      usedNonces: Array.isArray(parsed.usedNonces) ? parsed.usedNonces : [],
    };
  } catch {
    return emptyStore();
  }
}

export function writePairingStore(store: PairingStore) {
  mkdirSync(directory, { recursive: true });
  const target = storePath();
  const tmp = join(directory, `store.${randomBytes(6).toString("hex")}.tmp`);
  writeFileSync(tmp, JSON.stringify(store, null, 2));
  renameSync(tmp, target);
}

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

export function pruneStore(store: PairingStore, now = Date.now()): PairingStore {
  const cutoff = now - 24 * 60 * 60 * 1000;
  return {
    codes: store.codes.filter((c) => Date.parse(c.expiresAt) > now - 60_000 || (!c.usedAt && Date.parse(c.expiresAt) > cutoff)),
    devices: store.devices,
    reports: store.reports.slice(-500),
    usedNonces: store.usedNonces.filter((n) => Date.parse(n.at) > cutoff).slice(-2000),
  };
}

export function resetPairingStoreForTests() {
  if (existsSync(storePath())) {
    writePairingStore(emptyStore());
  } else {
    mkdirSync(directory, { recursive: true });
    writePairingStore(emptyStore());
  }
}
