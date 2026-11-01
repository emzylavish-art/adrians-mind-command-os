import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { decryptSecret, encryptSecret } from "./crypto.ts";

export const CONNECTOR_IDS = [
  "notion",
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

let directory = join(process.cwd(), ".data", "mind-connectors");

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

export function clearConnection(ownerId: string, connector: ConnectorId) {
  const path = ownerFile(ownerId, `${connector}.json`);
  if (existsSync(path)) unlinkSync(path);
}

export function getAccessToken(ownerId: string, connector: ConnectorId): string | null {
  const conn = readConnection(ownerId, connector);
  if (!conn) return null;
  return decryptSecret(conn.accessTokenEnc);
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
  const refresh = input.refreshToken ? encryptSecret(input.refreshToken) : undefined;
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
  saveConnection(conn);
  return conn;
}

export function savePendingOAuth(pending: PendingOAuth) {
  ensureOwnerDir(pending.ownerId);
  mkdirSync(join(directory, "pending"), { recursive: true });
  writeFileSync(join(directory, "pending", `${pending.state}.json`), JSON.stringify(pending));
}

export function takePendingOAuth(state: string): PendingOAuth | null {
  const path = join(directory, "pending", `${state}.json`);
  try {
    const pending = JSON.parse(readFileSync(path, "utf8")) as PendingOAuth;
    unlinkSync(path);
    return pending;
  } catch {
    return null;
  }
}

export function newOAuthState(): { state: string; codeVerifier: string; codeChallenge: string } {
  const state = randomBytes(24).toString("base64url");
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
