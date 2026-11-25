import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, unlinkSync, existsSync, readdirSync, renameSync } from "node:fs";
import { join, resolve, relative, sep, isAbsolute } from "node:path";
import { decryptSecret, encryptSecret } from "./crypto.ts";
import { localDataPath } from "../../local-data.ts";

export const CONNECTOR_IDS = [
  "notion",
  "youtube",
  "gmail",
  "google_calendar",
  "google_drive",
  "slack",
  "github",
] as const;

export type ConnectorId = (typeof CONNECTOR_IDS)[number];

export function isConnectorId(value: string): value is ConnectorId {
  return (CONNECTOR_IDS as readonly string[]).includes(value);
}

export const CONNECTOR_DISPLAY_NAMES: Record<ConnectorId, string> = {
  notion: "Notion",
  youtube: "YouTube",
  gmail: "Gmail",
  google_calendar: "Google Calendar",
  google_drive: "Google Drive",
  slack: "Slack",
  github: "GitHub",
};

export type StoredConnection = {
  connector: ConnectorId;
  ownerId: string;
  accessTokenEnc: string;
  refreshTokenEnc?: string;
  workspaceName?: string;
  workspaceId?: string;
  botId?: string;
  accountLabel?: string;
  connectedAt: string;
  tokenType?: string;
  scopes?: string;
};

export type ConnectionPublic = {
  connector: ConnectorId;
  state: "connected" | "not_configured" | "not_connected";
  detail: string;
  workspaceName?: string;
  accountLabel?: string;
  connectedAt?: string;
};

export type PendingOAuth = {
  state: string;
  ownerId: string;
  connector: ConnectorId;
  codeVerifier: string;
  redirectUri: string;
  createdAt: string;
  scopes?: string;
};

let directory = localDataPath("mind-connectors");

export function setConnectorDirectory(next: string) {
  directory = next;
}

export function connectorDirectory() {
  return directory;
}

function ownerFile(ownerId: string, name: string) {
  const hash = createHash("sha256").update(ownerId).digest("hex");
  return join(directory, hash, name);
}

function ensureOwnerDir(ownerId: string) {
  mkdirSync(join(directory, createHash("sha256").update(ownerId).digest("hex")), { recursive: true });
}

export function saveConnection(conn: StoredConnection) {
  ensureOwnerDir(conn.ownerId);
  writeFileSync(ownerFile(conn.ownerId, `${conn.connector}.json`), JSON.stringify(conn));
}

export function readConnection(ownerId: string, connector: ConnectorId): StoredConnection | null {
  try {
    const parsed = JSON.parse(readFileSync(ownerFile(ownerId, `${connector}.json`), "utf8")) as StoredConnection;
    if (parsed.ownerId !== ownerId || parsed.connector !== connector) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearConnection(ownerId: string, connector: ConnectorId, expectedConnectedAt?: string) {
  const active = readConnection(ownerId, connector);
  if (expectedConnectedAt && active?.connectedAt !== expectedConnectedAt) throw new Error("The selected connection changed. Refresh before disconnecting.");
  const workspace = connector === "notion" ? active?.workspaceId : null;
  if (workspace) {
    const archived = workspaceFile(ownerId, workspace);
    if (existsSync(archived)) unlinkSync(archived);
  }
  const path = ownerFile(ownerId, `${connector}.json`);
  if (existsSync(path)) unlinkSync(path);
  if (existsSync(pendingDir())) {
    for (const name of readdirSync(pendingDir())) {
      const file = pendingOAuthPath(name.replace(/\.json$/, ""));
      if (!file || !name.endsWith(".json")) continue;
      try {
        const entry = JSON.parse(readFileSync(file, "utf8")) as PendingOAuth;
        if (entry.ownerId === ownerId && entry.connector === connector) unlinkSync(file);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }
  return active;
}

export function getAccessToken(ownerId: string, connector: ConnectorId): string | null {
  const conn = readConnection(ownerId, connector);
  if (!conn) return null;
  return decryptSecret(conn.accessTokenEnc);
}

export function getRefreshToken(ownerId: string, connector: ConnectorId): string | null {
  const conn = readConnection(ownerId, connector);
  if (!conn?.refreshTokenEnc) return null;
  return decryptSecret(conn.refreshTokenEnc);
}

export function sameExternalAccount(previous: StoredConnection | null, incoming: { workspaceId?: string; accountLabel?: string }): boolean {
  if (!previous) return false;
  if (previous.workspaceId || incoming.workspaceId) return Boolean(previous.workspaceId && previous.workspaceId === incoming.workspaceId);
  return Boolean(previous.accountLabel?.includes("@") && previous.accountLabel === incoming.accountLabel);
}

function notionWorkspaceDir(owner: string) {
  return ownerFile(owner, "notion-workspaces");
}
function workspaceFile(owner: string, id: string) {
  return join(notionWorkspaceDir(owner), createHash("sha256").update(id).digest("hex") + ".json");
}
function archiveWorkspace(conn: StoredConnection) {
  if (!conn.workspaceId) return;
  mkdirSync(notionWorkspaceDir(conn.ownerId), { recursive: true });
  const path = workspaceFile(conn.ownerId, conn.workspaceId);
  const temp = path + "." + randomBytes(8).toString("hex");
  writeFileSync(temp, JSON.stringify(conn), { mode: 0o600 });
  renameSync(temp, path);
}
export function localNotionWorkspaces(owner: string): StoredConnection[] {
  const active = readConnection(owner, "notion");
  const dir = notionWorkspaceDir(owner);
  const rows = new Map<string, StoredConnection>();
  if (existsSync(dir)) for (const name of readdirSync(dir).filter((item) => item.endsWith(".json"))) {
    const row = JSON.parse(readFileSync(join(dir, name), "utf8")) as StoredConnection;
    if (row.ownerId === owner && row.connector === "notion" && row.workspaceId) rows.set(row.workspaceId, row);
  }
  if (active) rows.set(active.workspaceId || "legacy", active);
  return [...rows.values()];
}
export function selectLocalNotionWorkspace(owner: string, id: string) {
  const next = localNotionWorkspaces(owner).find((row) => (row.workspaceId || "legacy") === id);
  if (!next) throw new Error("That workspace is no longer connected.");
  const current = readConnection(owner, "notion");
  if (current) archiveWorkspace(current);
  saveConnection(next);
}

export function storeAccessToken(input: {
  ownerId: string;
  connector: ConnectorId;
  accessToken: string;
  refreshToken?: string;
  workspaceName?: string;
  workspaceId?: string;
  botId?: string;
  accountLabel?: string;
  tokenType?: string;
  scopes?: string;
}): StoredConnection {
  const access = encryptSecret(input.accessToken);
  const active = readConnection(input.ownerId, input.connector);
  const previous = input.connector === "notion" && input.workspaceId
    ? localNotionWorkspaces(input.ownerId).find((row) => row.workspaceId === input.workspaceId) ?? null
    : active;
  const refresh = input.refreshToken
    ? encryptSecret(input.refreshToken)
    : sameExternalAccount(previous, input) && previous?.refreshTokenEnc
      ? { ciphertext: previous.refreshTokenEnc }
      : undefined;
  const conn: StoredConnection = {
    connector: input.connector,
    ownerId: input.ownerId,
    accessTokenEnc: access.ciphertext,
    refreshTokenEnc: refresh?.ciphertext,
    workspaceName: input.workspaceName,
    workspaceId: input.workspaceId,
    botId: input.botId,
    accountLabel: input.accountLabel,
    connectedAt: new Date().toISOString(),
    tokenType: input.tokenType,
    scopes: input.scopes,
  };
  if (input.connector === "notion" && input.workspaceId) {
    archiveWorkspace(conn);
    if (active && active.workspaceId !== input.workspaceId) return conn;
  }
  if (input.connector === "notion" && active?.workspaceId && !input.workspaceId) throw new Error("Notion did not identify the workspace.");
  saveConnection(conn);
  return conn;
}

export const OAUTH_STATE_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
export const PENDING_OAUTH_TTL_MS = 10 * 60 * 1000;

export function isValidOAuthState(state: string): boolean {
  return typeof state === "string" && OAUTH_STATE_PATTERN.test(state) && !state.includes("\0");
}

function pendingDir(): string {
  return resolve(directory, "pending");
}

/** Resolve pending file path only when state is a strict token and stays inside pending/. */
export function pendingOAuthPath(state: string): string | null {
  if (!isValidOAuthState(state)) return null;
  const base = pendingDir();
  const candidate = resolve(base, `${state}.json`);
  const rel = relative(base, candidate);
  if (!rel || rel.startsWith("..") || isAbsolute(rel) || rel.includes(`..${sep}`)) return null;
  if (!candidate.startsWith(base + sep)) return null;
  return candidate;
}

export function pruneStalePendingOAuth(nowMs = Date.now()): number {
  const base = pendingDir();
  if (!existsSync(base)) return 0;
  let removed = 0;
  for (const name of readdirSync(base)) {
    if (!name.endsWith(".json")) continue;
    const state = name.slice(0, -".json".length);
    const path = pendingOAuthPath(state);
    if (!path) continue;
    try {
      const pending = JSON.parse(readFileSync(path, "utf8")) as PendingOAuth;
      const created = Date.parse(pending.createdAt);
      if (!Number.isFinite(created) || nowMs - created > PENDING_OAUTH_TTL_MS) {
        unlinkSync(path);
        removed += 1;
      }
    } catch {
      try {
        unlinkSync(path);
        removed += 1;
      } catch {
        /* ignore */
      }
    }
  }
  return removed;
}

export function savePendingOAuth(pending: PendingOAuth) {
  if (!isValidOAuthState(pending.state)) {
    throw new Error("Refusing to store OAuth pending state with an invalid state token.");
  }
  if (!isConnectorId(pending.connector)) {
    throw new Error("Refusing to store OAuth pending state with an unknown connector.");
  }
  ensureOwnerDir(pending.ownerId);
  mkdirSync(pendingDir(), { recursive: true });
  pruneStalePendingOAuth();
  const path = pendingOAuthPath(pending.state);
  if (!path) throw new Error("Invalid OAuth state path.");
  writeFileSync(path, JSON.stringify(pending));
}

/**
 * Single-use consume: validate state, enforce path containment + TTL, delete on read.
 * Returns null for invalid / missing / expired / corrupt entries.
 */
export function takePendingOAuth(state: string, nowMs = Date.now()): PendingOAuth | null {
  pruneStalePendingOAuth(nowMs);
  const path = pendingOAuthPath(state);
  if (!path) return null;
  const claimed = `${path}.claimed.${randomBytes(8).toString("hex")}`;
  try {
    // Atomic claim so concurrent callbacks cannot both consume the same state.
    renameSync(path, claimed);
  } catch {
    return null;
  }
  try {
    const raw = readFileSync(claimed, "utf8");
    unlinkSync(claimed);
    const pending = JSON.parse(raw) as PendingOAuth;
    if (!pending || pending.state !== state) return null;
    if (!isConnectorId(pending.connector)) return null;
    const created = Date.parse(pending.createdAt);
    if (!Number.isFinite(created) || nowMs - created > PENDING_OAUTH_TTL_MS) return null;
    return pending;
  } catch {
    try {
      unlinkSync(claimed);
    } catch {
      /* ignore */
    }
    return null;
  }
}

export function newOAuthState(): { state: string; codeVerifier: string; codeChallenge: string } {
  const state = randomBytes(32).toString("base64url");
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  return { state, codeVerifier, codeChallenge };
}

export function toPublic(
  connector: ConnectorId,
  conn: StoredConnection | null,
  configured: boolean,
): ConnectionPublic {
  const name = CONNECTOR_DISPLAY_NAMES[connector];
  if (!configured) {
    return {
      connector,
      state: "not_configured",
      detail: `${name} OAuth is not configured on the server. Set the required client id, client secret, and redirect URI env vars. Nothing was connected.`,
    };
  }
  if (!conn) {
    return {
      connector,
      state: "not_connected",
      detail: `${name} is not connected. Press Connect to start OAuth. No token is stored.`,
    };
  }
  const label = conn.workspaceName || conn.accountLabel || name;
  return {
    connector,
    state: "connected",
    detail: `Connected to ${label}${conn.connectedAt ? ` · since ${conn.connectedAt}` : ""}. Tokens stay on the server.`,
    workspaceName: conn.workspaceName,
    accountLabel: conn.accountLabel,
    connectedAt: conn.connectedAt,
  };
}
