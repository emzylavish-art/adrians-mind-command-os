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
  return env.NOTION_TOKEN?.trim() || env.NOTION_API_KEY?.trim() || undefined;
}

/** Prefer OAuth-stored token, then env integration token. Legacy local-test helper. */
export function resolveNotionToken(ownerId: string | undefined, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (ownerId) {
    const oauth = getAccessToken(ownerId, "notion");
    if (oauth) return oauth;
  }
  return env.NOTION_TOKEN?.trim() || env.NOTION_API_KEY?.trim() || undefined;
}
