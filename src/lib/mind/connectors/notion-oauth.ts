import {
  clearConnection,
  getAccessToken,
  newOAuthState,
  readConnection,
  savePendingOAuth,
  storeAccessToken,
  takePendingOAuth,
  toPublic,
  type ConnectionPublic,
} from "./store.ts";

export type NotionOAuthEnv = {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  authorizeUrl?: string;
  tokenUrl?: string;
  revokeUrl?: string;
};

export function readNotionOAuthEnv(env: NodeJS.ProcessEnv = process.env): NotionOAuthEnv {
  return {
    clientId: env.NOTION_OAUTH_CLIENT_ID?.trim() || undefined,
    clientSecret: env.NOTION_OAUTH_CLIENT_SECRET?.trim() || undefined,
    redirectUri: env.NOTION_OAUTH_REDIRECT_URI?.trim() || undefined,
    authorizeUrl: env.NOTION_OAUTH_AUTHORIZE_URL?.trim() || "https://api.notion.com/v1/oauth/authorize",
    tokenUrl: env.NOTION_OAUTH_TOKEN_URL?.trim() || "https://api.notion.com/v1/oauth/token",
    revokeUrl: env.NOTION_OAUTH_REVOKE_URL?.trim() || undefined,
  };
}

export function notionOAuthConfigured(env: NotionOAuthEnv = readNotionOAuthEnv()): boolean {
  return Boolean(env.clientId && env.clientSecret && env.redirectUri);
}

export function buildNotionAuthorizeUrl(input: {
  ownerId: string;
  env?: NotionOAuthEnv;
}): { ok: true; url: string; state: string } | { ok: false; error: string } {
  const env = input.env ?? readNotionOAuthEnv();
  if (!notionOAuthConfigured(env) || !env.clientId || !env.redirectUri || !env.authorizeUrl) {
    return {
      ok: false,
      error: "Notion OAuth is not configured. Set NOTION_OAUTH_CLIENT_ID, NOTION_OAUTH_CLIENT_SECRET, and NOTION_OAUTH_REDIRECT_URI. Nothing was started.",
    };
  }
  const { state, codeVerifier, codeChallenge } = newOAuthState();
  savePendingOAuth({
    state,
    ownerId: input.ownerId,
    connector: "notion",
    codeVerifier,
    redirectUri: env.redirectUri,
    createdAt: new Date().toISOString(),
  });
  const url = new URL(env.authorizeUrl);
  url.searchParams.set("client_id", env.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("owner", "user");
  url.searchParams.set("redirect_uri", env.redirectUri);
  url.searchParams.set("state", state);
  // PKCE where supported (Notion ignores unknown params on classic OAuth; kept for compatible proxies / future)
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return { ok: true, url: url.toString(), state };
}

type FetchLike = (url: string, init?: RequestInit) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

export async function exchangeNotionCode(input: {
  code: string;
  state: string;
  env?: NotionOAuthEnv;
  fetch?: FetchLike;
}): Promise<{ ok: true; public: ConnectionPublic } | { ok: false; error: string }> {
  const env = input.env ?? readNotionOAuthEnv();
  if (!notionOAuthConfigured(env) || !env.clientId || !env.clientSecret || !env.tokenUrl) {
    return { ok: false, error: "Notion OAuth is not configured. Nothing was stored." };
  }
  const pending = takePendingOAuth(input.state);
  if (!pending || pending.connector !== "notion") {
    return { ok: false, error: "OAuth state is invalid or expired. Nothing was stored." };
  }
  const basic = Buffer.from(`${env.clientId}:${env.clientSecret}`).toString("base64");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: pending.redirectUri,
    // Include verifier when a provider honors PKCE
    code_verifier: pending.codeVerifier,
  });
  const fetchImpl = input.fetch ?? (globalThis.fetch as FetchLike);
  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await fetchImpl(env.tokenUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
    });
  } catch {
    return { ok: false, error: "Notion token endpoint could not be reached. Nothing was stored." };
  }
  const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || !json || typeof json.access_token !== "string") {
    const message =
      json && typeof json.error_description === "string"
        ? json.error_description
        : json && typeof json.message === "string"
          ? json.message
          : `Token exchange failed (${response.status}).`;
    return { ok: false, error: `${message} Nothing was stored.` };
  }
  const workspaceName =
    json.workspace_name && typeof json.workspace_name === "string" ? json.workspace_name : undefined;
  const workspaceId = json.workspace_id && typeof json.workspace_id === "string" ? json.workspace_id : undefined;
  const botId = json.bot_id && typeof json.bot_id === "string" ? json.bot_id : undefined;
  const owner = json.owner && typeof json.owner === "object" ? (json.owner as { user?: { name?: string; person?: { email?: string } } }) : null;
  const accountLabel = owner?.user?.person?.email || owner?.user?.name || undefined;
  const conn = storeAccessToken({
    ownerId: pending.ownerId,
    connector: "notion",
    accessToken: json.access_token,
    refreshToken: typeof json.refresh_token === "string" ? json.refresh_token : undefined,
    workspaceName,
    workspaceId,
    botId,
    accountLabel,
    tokenType: typeof json.token_type === "string" ? json.token_type : "bearer",
  });
  return { ok: true, public: toPublic(conn, true) };
}

export function notionConnectionStatus(ownerId: string, env?: NotionOAuthEnv): ConnectionPublic {
  const cfg = env ?? readNotionOAuthEnv();
  const configured = notionOAuthConfigured(cfg);
  return toPublic(readConnection(ownerId, "notion"), configured);
}

export async function disconnectNotion(input: {
  ownerId: string;
  env?: NotionOAuthEnv;
  fetch?: FetchLike;
}): Promise<ConnectionPublic> {
  const env = input.env ?? readNotionOAuthEnv();
  const token = getAccessToken(input.ownerId, "notion");
  if (token && env.revokeUrl) {
    const fetchImpl = input.fetch ?? (globalThis.fetch as FetchLike);
    try {
      await fetchImpl(env.revokeUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ token }),
      });
    } catch {
      /* still clear local record */
    }
  }
  clearConnection(input.ownerId, "notion");
  return toPublic(null, notionOAuthConfigured(env));
}

/** Prefer OAuth-stored token, then env integration token. */
export function resolveNotionToken(ownerId: string | undefined, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (ownerId) {
    const oauth = getAccessToken(ownerId, "notion");
    if (oauth) return oauth;
  }
  return env.NOTION_TOKEN?.trim() || env.NOTION_API_KEY?.trim() || undefined;
}
