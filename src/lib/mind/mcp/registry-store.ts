/**
 * One per-user MCP registry.
 *
 * Production writes go to `mind_mcp_registry` when DATABASE_URL or POSTGRES_URL
 * is set. Bearer tokens and stdio env maps are stored only as
 * CONNECTOR_TOKEN_SECRET ciphertext (AES-256-GCM via connectors/crypto.ts).
 * Without that secret, a record that needs a secret is not written.
 * Without a database URL, writes do not create `.data/mind-mcp-registry`.
 * A legacy JSON file is read and left on disk; it is never deleted here.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { connectorTokenSecretStatus, decryptSecret, encryptSecret } from "../connectors/crypto.ts";
import { resolveDatabaseUrl } from "../../env.server.ts";
import { localDataPath } from "../../local-data.ts";

export type RegistryDb = {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export type RegistryKind = "builtin" | "http" | "command";

/** Server row. `token` and `env` exist only in process memory after decrypt. */
export type RegistryRecord = {
  id: string;
  label: string;
  kind: RegistryKind;
  enabled: boolean;
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  token?: string;
  connectTimeoutMs?: number;
  callTimeoutMs?: number;
  builtin?: boolean;
  protocol?: "mcp" | "http";
  httpMethod?: "GET" | "POST";
  operations?: unknown;
  state?: string;
  error?: string;
  /** Ciphertext only. Never a bearer or env plaintext. */
  tokenEnc?: string;
  envEnc?: string;
  /** Set when a secret exists but cannot be used. Not a stored column by itself. */
  secretUnreadable?: boolean;
  /** Durable deletion marker: suppresses read-only legacy re-import; never public. */
  deleted?: boolean;
};

export type RegistryPersistence = "durable" | "memory" | "legacy-readonly" | "missing_config";

export type RegistryLoad = {
  servers: RegistryRecord[];
  persistence: RegistryPersistence;
  legacyFilePresent: boolean;
};

const BUILTIN_ID = "builtin-mind";
const TABLE = "mind_mcp_registry";

let memory: Map<string, RegistryRecord[]> | null = null;
let legacyDirectory: string | null = null;
let connectedLegacyDirectory: string | null = null;

export function registryBuiltinId() {
  return BUILTIN_ID;
}

/** Test double. Writes stay in this process. The directory is only a legacy read path. */
export function setMcpRegistryDirectory(next: string) {
  memory = new Map();
  legacyDirectory = next;
}

/** Test isolation. Production never calls this. */
export function resetRegistryStoreForTests() {
  memory = null;
  legacyDirectory = null;
  connectedLegacyDirectory = null;
}

/** Read-only directory for the older Connected-form files. Null uses .data/mind-mcp. */
export function setConnectedLegacyDirectory(next: string | null) {
  connectedLegacyDirectory = next;
}

export function databaseConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(resolveDatabaseUrl(env));
}

function defaultBuiltin(): RegistryRecord {
  return { id: BUILTIN_ID, label: "Mind built-in", kind: "builtin", enabled: true, builtin: true };
}

function withBuiltin(servers: RegistryRecord[]): RegistryRecord[] {
  const builtin = servers.find((server) => server.id === BUILTIN_ID);
  const rest = servers.filter((server) => server.id !== BUILTIN_ID && !server.deleted);
  return [{ ...defaultBuiltin(), ...builtin, id: BUILTIN_ID, kind: "builtin", builtin: true }, ...rest];
}

function legacyPath(userId: string): string | null {
  const directory = legacyDirectory ?? localDataPath("mind-mcp-registry");
  return join(directory, `${createHash("sha256").update(userId).digest("hex")}.json`);
}

export function readLegacyRegistryFile(userId: string): { present: boolean; servers: RegistryRecord[] } {
  const path = legacyPath(userId);
  if (!path) return { present: false, servers: [] };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { servers?: RegistryRecord[] };
    const servers = Array.isArray(parsed.servers) ? parsed.servers : [];
    return { present: true, servers };
  } catch {
    return { present: false, servers: [] };
  }
}

function connectedLegacyPath(userId: string) {
  const directory = connectedLegacyDirectory ?? localDataPath("mind-mcp");
  return join(directory, `${createHash("sha256").update(userId).digest("hex")}.json`);
}

/** Older Connected form: `.data/mind-mcp/<sha256>.json`. Read only. */
export function readConnectedLegacyFile(userId: string): { present: boolean; servers: RegistryRecord[] } {
  try {
    const parsed = JSON.parse(readFileSync(connectedLegacyPath(userId), "utf8")) as { servers?: Record<string, unknown>[] };
    const rows = Array.isArray(parsed.servers) ? parsed.servers : [];
    const servers: RegistryRecord[] = [];
    for (const raw of rows) {
      if (typeof raw.ownerId === "string" && raw.ownerId !== userId) continue;
      if (typeof raw.id !== "string" || typeof raw.url !== "string") continue;
      const tools = Array.isArray(raw.tools) ? raw.tools : [];
      const state = raw.state === "connected" ? "ready" : raw.state === "failed" ? "failed" : "unchecked";
      servers.push({
        id: raw.id,
        label: typeof raw.label === "string" ? raw.label : "MCP",
        kind: "http",
        protocol: "mcp",
        enabled: true,
        url: raw.url,
        token: typeof raw.token === "string" ? raw.token : undefined,
        state,
        error: typeof raw.error === "string" ? raw.error : "",
        operations: tools.filter((tool) => tool && typeof tool === "object" && typeof (tool as { name?: unknown }).name === "string").map((tool) => ({
          name: (tool as { name: string }).name,
          description: typeof (tool as { description?: unknown }).description === "string" ? (tool as { description: string }).description : "",
          inputSchema: null,
          compatible: false,
        })),
      });
    }
    return { present: true, servers };
  } catch {
    return { present: false, servers: [] };
  }
}

function mergeLegacy(primary: RegistryRecord[], extra: RegistryRecord[]): RegistryRecord[] {
  const ids = new Set(primary.map((server) => server.id));
  return [...primary, ...extra.filter((server) => !ids.has(server.id))];
}

function recordNeedsSecret(server: RegistryRecord): boolean {
  return Boolean(server.token) || Boolean(server.env && Object.keys(server.env).length);
}

function sealString(value: string): { ok: true; ciphertext: string } | { ok: false; error: string } {
  const status = connectorTokenSecretStatus();
  if (!status.ok) return { ok: false, error: `${status.error} Nothing was saved.` };
  return { ok: true, ciphertext: encryptSecret(value).ciphertext };
}

/** JSON stored in SQL. Never includes token or env plaintext. */
export function toDurableRecord(server: RegistryRecord): { ok: true; record: Record<string, unknown> } | { ok: false; error: string } {
  const { token, env, tokenEnc, envEnc, secretUnreadable: _unread, ...rest } = server;
  let nextTokenEnc = tokenEnc;
  let nextEnvEnc = envEnc;
  if (token) {
    const sealed = sealString(token);
    if (!sealed.ok) return sealed;
    nextTokenEnc = sealed.ciphertext;
  }
  if (env && Object.keys(env).length) {
    const sealed = sealString(JSON.stringify(env));
    if (!sealed.ok) return sealed;
    nextEnvEnc = sealed.ciphertext;
  }
  const record: Record<string, unknown> = { ...rest, ...(nextTokenEnc ? { tokenEnc: nextTokenEnc } : {}), ...(nextEnvEnc ? { envEnc: nextEnvEnc } : {}) };
  if ("token" in record || "env" in record) {
    return { ok: false, error: "Refusing to store a bearer token or env map in plaintext. Nothing was saved." };
  }
  return { ok: true, record };
}

function fromDurableRecord(raw: Record<string, unknown>): RegistryRecord {
  const tokenEnc = typeof raw.tokenEnc === "string" ? raw.tokenEnc : "";
  const envEnc = typeof raw.envEnc === "string" ? raw.envEnc : "";
  const token = tokenEnc ? decryptSecret(tokenEnc) ?? undefined : undefined;
  let env: Record<string, string> | undefined;
  if (envEnc) {
    const decoded = decryptSecret(envEnc);
    if (decoded) {
      try {
        const parsed = JSON.parse(decoded) as Record<string, unknown>;
        env = {};
        for (const [key, value] of Object.entries(parsed)) if (typeof value === "string") env[key] = value;
      } catch {
        env = undefined;
      }
    }
  }
  const plaintextToken = typeof raw.token === "string" ? raw.token : "";
  const { tokenEnc: _tokenEnc, envEnc: _envEnc, token: _token, env: _env, ...rest } = raw;
  return {
    ...(rest as RegistryRecord),
    ...(tokenEnc ? { tokenEnc } : {}),
    ...(envEnc ? { envEnc } : {}),
    ...(token ? { token } : {}),
    ...(env ? { env } : {}),
    secretUnreadable: Boolean((tokenEnc && !token) || (envEnc && !env) || plaintextToken),
  };
}

function stripLegacySecrets(servers: RegistryRecord[]): RegistryRecord[] {
  return servers.map((server) => {
    if (!recordNeedsSecret(server)) return { ...server, token: undefined, env: undefined };
    const { token: _token, env: _env, ...rest } = server;
    return { ...rest, secretUnreadable: true };
  });
}

async function readDb(db: RegistryDb, userId: string): Promise<RegistryRecord[]> {
  const rows = await db.query<{ record: RegistryRecord | string }>(
    `select record from ${TABLE} where user_id = $1`,
    [userId],
  );
  const servers: RegistryRecord[] = [];
  for (const row of rows) {
    const record = typeof row.record === "string" ? JSON.parse(row.record) as Record<string, unknown> : row.record as unknown as Record<string, unknown>;
    if (record && typeof record === "object") servers.push(fromDurableRecord(record));
  }
  return servers;
}

async function writeDb(db: RegistryDb, userId: string, servers: RegistryRecord[]): Promise<{ ok: true } | { ok: false; error: string }> {
  // Public loads intentionally hide markers. Preserve them when a caller saves
  // that visible snapshot, including during a later legacy import.
  const tombstones = (await readDb(db, userId)).filter((server) => server.deleted);
  const deletedIds = new Set(tombstones.map((server) => server.id));
  const next = [...servers.filter((server) => !deletedIds.has(server.id)), ...tombstones];
  const sealed: { id: string; record: Record<string, unknown> }[] = [];
  for (const server of next) {
    const next = toDurableRecord({ ...server, secretUnreadable: undefined });
    if (!next.ok) return next;
    sealed.push({ id: server.id, record: next.record });
  }
  const existing = await db.query<{ id: string }>(`select id from ${TABLE} where user_id = $1`, [userId]);
  const keep = new Set(sealed.map((row) => row.id));
  for (const row of existing) {
    if (!keep.has(row.id)) await db.query(`delete from ${TABLE} where user_id = $1 and id = $2`, [userId, row.id]);
  }
  for (const row of sealed) {
    await db.query(
      `insert into ${TABLE} (user_id, id, record) values ($1, $2, $3::jsonb) on conflict (user_id, id) do update set record = excluded.record`,
      [userId, row.id, JSON.stringify(row.record)],
    );
  }
  return { ok: true };
}

async function importLegacy(db: RegistryDb, userId: string, fileServers: RegistryRecord[]): Promise<{ ok: true } | { ok: false }> {
  const current = await readDb(db, userId);
  const have = new Set(current.map((server) => server.id));
  const missing = fileServers.filter((server) => !have.has(server.id) && server.id !== BUILTIN_ID);
  if (!missing.length) return { ok: true };
  if (missing.some(recordNeedsSecret) && !connectorTokenSecretStatus().ok) return { ok: false };
  const next = [...current.filter((server) => server.id !== BUILTIN_ID), ...missing];
  const builtin = fileServers.find((server) => server.id === BUILTIN_ID);
  const saved = await writeDb(db, userId, withBuiltin(builtin ? [{ ...builtin, token: undefined, env: undefined }, ...next] : next));
  return saved.ok ? { ok: true } : { ok: false };
}

export async function loadRegistry(userId: string, db?: RegistryDb | null): Promise<RegistryLoad> {
  const registryFile = readLegacyRegistryFile(userId);
  const connectedFile = readConnectedLegacyFile(userId);
  const legacyServers = mergeLegacy(registryFile.servers, connectedFile.servers);
  const legacyFilePresent = registryFile.present || connectedFile.present;
  if (db) {
    let stored = await readDb(db, userId);
    if (legacyFilePresent) {
      const imported = await importLegacy(db, userId, legacyServers);
      if (imported.ok) stored = await readDb(db, userId);
      else {
        const ids = new Set(stored.map((server) => server.id));
        const visible = stripLegacySecrets(legacyServers.filter((server) => !ids.has(server.id) && server.id !== BUILTIN_ID));
        return { servers: withBuiltin([...stored, ...visible]), persistence: "legacy-readonly", legacyFilePresent: true };
      }
    }
    return { servers: withBuiltin(stored), persistence: "durable", legacyFilePresent };
  }
  if (memory) {
    if (!memory.has(userId) && legacyServers.length) memory.set(userId, legacyServers.map((server) => ({ ...server })));
    return { servers: withBuiltin(memory.get(userId) ?? []), persistence: "memory", legacyFilePresent };
  }
  if (legacyServers.length) {
    return { servers: withBuiltin(stripLegacySecrets(legacyServers)), persistence: "legacy-readonly", legacyFilePresent: true };
  }
  return { servers: withBuiltin([]), persistence: "missing_config", legacyFilePresent: false };
}

export async function saveRegistry(
  userId: string,
  servers: RegistryRecord[],
  db?: RegistryDb | null,
): Promise<{ ok: true; persistence: RegistryPersistence } | { ok: false; code: "missing_config"; error: string }> {
  const next = withBuiltin(servers);
  if (next.some((server) => server.secretUnreadable)) {
    return {
      ok: false,
      code: "missing_config",
      error: "CONNECTOR_TOKEN_SECRET is not set, so a legacy secret was not copied. The legacy file was left unchanged. Nothing was saved.",
    };
  }
  if (db) {
    const saved = await writeDb(db, userId, next);
    if (!saved.ok) return { ok: false, code: "missing_config", error: saved.error };
    return { ok: true, persistence: "durable" };
  }
  if (memory) {
    const tombstones = (memory.get(userId) ?? []).filter((server) => server.deleted);
    const deletedIds = new Set(tombstones.map((server) => server.id));
    memory.set(userId, [...next.filter((server) => !deletedIds.has(server.id)), ...tombstones].map((server) => ({ ...server })));
    return { ok: true, persistence: "memory" };
  }
  return {
    ok: false,
    code: "missing_config",
    error: "No durable database is configured (DATABASE_URL or POSTGRES_URL). Nothing was saved.",
  };
}

export function registryCanPersist(load: RegistryLoad, db?: RegistryDb | null): boolean {
  return Boolean(db) || (memory !== null && load.persistence === "memory");
}

/** Delete only this owner's row, retaining a secret-free marker for legacy imports. */
export async function deleteRegistryServer(userId: string, id: string, db?: RegistryDb | null): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!id || id === BUILTIN_ID) return { ok: false, error: "That MCP server cannot be removed. Nothing was removed." };
  const tombstone: RegistryRecord = { id, label: "", kind: "http", enabled: false, deleted: true };
  if (db) {
    await db.query(
      `insert into ${TABLE} (user_id, id, record) values ($1, $2, $3::jsonb) on conflict (user_id, id) do update set record = excluded.record`,
      [userId, id, JSON.stringify(tombstone)],
    );
    return { ok: true };
  }
  if (memory) {
    const loaded = await loadRegistry(userId);
    memory.set(userId, [...loaded.servers.filter((server) => server.id !== id), tombstone]);
    return { ok: true };
  }
  return { ok: false, error: "No durable database is configured (DATABASE_URL or POSTGRES_URL). Nothing was removed." };
}
