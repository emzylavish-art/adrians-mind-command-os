import { getAccessToken } from "./store.ts";
import { getDurableAccessToken, hasDurableOAuthStore } from "./durable-oauth.server.ts";
import type { ConnectionPublic } from "./store.ts";
import {
  buildAuthorizeUrl,
  buildAuthorizeUrlPersistent,
  connectionStatus,
  connectionStatusPersistent,
  disconnectProvider,
  exchangeAuthorizationCode,
  providerConfigured,
  type DisconnectResult,
  type FetchLike,
  type OAuthProviderEnv,
} from "./oauth-provider.ts";
import { getProvider } from "./providers.ts";

export type NotionOAuthEnv = OAuthProviderEnv;

const notion = () => getProvider("notion");

export function readNotionOAuthEnv(env: NodeJS.ProcessEnv = process.env): NotionOAuthEnv {
  return notion().readEnv(env);
}

export function notionOAuthConfigured(env: NotionOAuthEnv = readNotionOAuthEnv()): boolean {
  return providerConfigured(env);
}

export function buildNotionAuthorizeUrl(input: {
  ownerId: string;
  env?: NotionOAuthEnv;
}): { ok: true; url: string; state: string } | { ok: false; error: string } {
  return buildAuthorizeUrl(notion(), input);
}

export async function buildNotionAuthorizeUrlPersistent(input: {
  ownerId: string;
  env?: NotionOAuthEnv;
}): Promise<{ ok: true; url: string; state: string } | { ok: false; error: string }> {
  return buildAuthorizeUrlPersistent(notion(), input);
}

export async function exchangeNotionCode(input: {
  code: string;
  state: string;
  expectedOwnerId?: string;
  env?: NotionOAuthEnv;
  fetch?: FetchLike;
}): Promise<{ ok: true; public: ConnectionPublic } | { ok: false; error: string }> {
  return exchangeAuthorizationCode(notion(), input);
}

export function notionConnectionStatus(ownerId: string, env?: NotionOAuthEnv): ConnectionPublic {
  return connectionStatus(notion(), ownerId, env);
}

export async function notionConnectionStatusPersistent(ownerId: string, env?: NotionOAuthEnv): Promise<ConnectionPublic> {
  return connectionStatusPersistent(notion(), ownerId, env);
}

export async function disconnectNotion(input: {
  ownerId: string;
  env?: NotionOAuthEnv;
  fetch?: FetchLike;
  expectedConnectedAt?: string;
}): Promise<DisconnectResult> {
  return disconnectProvider(notion(), input);
}

/** Durable token resolution for production tool calls. */
export async function resolveNotionTokenPersistent(
  ownerId: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | undefined> {
  if (ownerId) {
    const oauth = hasDurableOAuthStore()
      ? await getDurableAccessToken(ownerId, "notion")
      : getAccessToken(ownerId, "notion");
    if (oauth) return oauth;
  }
  return undefined;
}

/** Resolve only the specified owner’s local OAuth grant. */
export function resolveNotionToken(ownerId: string | undefined, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (ownerId) {
    const oauth = getAccessToken(ownerId, "notion");
    if (oauth) return oauth;
  }
  return undefined;
}

export async function savedNotionWorkspaces(owner: string) {
  const { listDurableNotionWorkspaces, readDurableConnection } = await import("./durable-oauth.server.ts");
  const { localNotionWorkspaces, readConnection } = await import("./store.ts");
  const durable = hasDurableOAuthStore();
  const rows = durable ? await listDurableNotionWorkspaces(owner) : localNotionWorkspaces(owner);
  const active = durable ? await readDurableConnection(owner, "notion") : readConnection(owner, "notion");
  return rows.map((row) => ({
    id: row.workspaceId || "legacy", name: row.workspaceName || row.accountLabel || "Notion workspace",
    active: Boolean(active && active.workspaceId === row.workspaceId),
  }));
}

export async function resolveWorkspaceGrant(owner: string, id: string) {
  const { listDurableNotionWorkspaces } = await import("./durable-oauth.server.ts");
  const { localNotionWorkspaces } = await import("./store.ts");
  const { decryptSecret } = await import("./crypto.ts");
  const rows = hasDurableOAuthStore() ? await listDurableNotionWorkspaces(owner) : localNotionWorkspaces(owner);
  const match = rows.find((row) => (row.workspaceId || "legacy") === id);
  return match ? decryptSecret(match.accessTokenEnc) ?? undefined : undefined;
}
