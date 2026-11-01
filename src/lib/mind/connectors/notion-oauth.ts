import { getAccessToken } from "./store.ts";
import type { ConnectionPublic } from "./store.ts";
import {
  buildAuthorizeUrl,
  connectionStatus,
  disconnectProvider,
  exchangeAuthorizationCode,
  providerConfigured,
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

export async function exchangeNotionCode(input: {
  code: string;
  state: string;
  env?: NotionOAuthEnv;
  fetch?: FetchLike;
}): Promise<{ ok: true; public: ConnectionPublic } | { ok: false; error: string }> {
  return exchangeAuthorizationCode(notion(), input);
}

export function notionConnectionStatus(ownerId: string, env?: NotionOAuthEnv): ConnectionPublic {
  return connectionStatus(notion(), ownerId, env);
}

export async function disconnectNotion(input: {
  ownerId: string;
  env?: NotionOAuthEnv;
  fetch?: FetchLike;
}): Promise<ConnectionPublic> {
  return disconnectProvider(notion(), input);
}

/** Prefer OAuth-stored token, then env integration token. */
export function resolveNotionToken(ownerId: string | undefined, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (ownerId) {
    const oauth = getAccessToken(ownerId, "notion");
    if (oauth) return oauth;
  }
  return env.NOTION_TOKEN?.trim() || env.NOTION_API_KEY?.trim() || undefined;
}
