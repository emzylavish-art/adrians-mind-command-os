import type { ConnectorId } from "./store.ts";
import type { AccountHints, OAuthProvider, OAuthProviderEnv } from "./oauth-provider.ts";

function trim(env: NodeJS.ProcessEnv, key: string): string | undefined {
  return env[key]?.trim() || undefined;
}

function googleBaseEnv(env: NodeJS.ProcessEnv, redirectKey: string, redirectFallback?: string): OAuthProviderEnv {
  return {
    clientId: trim(env, "GOOGLE_OAUTH_CLIENT_ID"),
    clientSecret: trim(env, "GOOGLE_OAUTH_CLIENT_SECRET"),
    redirectUri: trim(env, redirectKey) || (redirectFallback ? trim(env, redirectFallback) : undefined),
    authorizeUrl: trim(env, "GOOGLE_OAUTH_AUTHORIZE_URL") || "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: trim(env, "GOOGLE_OAUTH_TOKEN_URL") || "https://oauth2.googleapis.com/token",
    revokeUrl: trim(env, "GOOGLE_OAUTH_REVOKE_URL") || "https://oauth2.googleapis.com/revoke",
  };
}

function parseGoogleAccount(json: Record<string, unknown>): AccountHints {
  // Token response rarely includes email; optional id_token / later userinfo. Prefer refresh presence label.
  const scope = typeof json.scope === "string" ? json.scope : undefined;
  return {
    accountLabel: scope ? `Google · ${scope.split(" ").slice(-1)[0]?.split("/").pop() || "account"}` : "Google account",
  };
}

const gmailProvider: OAuthProvider = {
  id: "gmail",
  displayName: "Gmail",
  envKeys: {
    clientId: "GOOGLE_OAUTH_CLIENT_ID",
    clientSecret: "GOOGLE_OAUTH_CLIENT_SECRET",
    redirectUri: "GOOGLE_OAUTH_GMAIL_REDIRECT_URI",
    authorizeUrl: "GOOGLE_OAUTH_AUTHORIZE_URL",
    tokenUrl: "GOOGLE_OAUTH_TOKEN_URL",
    revokeUrl: "GOOGLE_OAUTH_REVOKE_URL",
  },
  defaults: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    revokeUrl: "https://oauth2.googleapis.com/revoke",
  },
  scopes: [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
  ],
  pkce: true,
  tokenAuth: "body",
  revokeStyle: "form_token",
  authorizeExtra: {
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
  },
  readEnv: (env = process.env) =>
    googleBaseEnv(env, "GOOGLE_OAUTH_GMAIL_REDIRECT_URI", "GOOGLE_OAUTH_REDIRECT_URI"),
  parseAccount: parseGoogleAccount,
  notConfiguredDetail:
    "Gmail OAuth is not configured. Set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, and GOOGLE_OAUTH_GMAIL_REDIRECT_URI (or GOOGLE_OAUTH_REDIRECT_URI). Nothing was started.",
};

const googleCalendarProvider: OAuthProvider = {
  id: "google_calendar",
  displayName: "Google Calendar",
  envKeys: {
    clientId: "GOOGLE_OAUTH_CLIENT_ID",
    clientSecret: "GOOGLE_OAUTH_CLIENT_SECRET",
    redirectUri: "GOOGLE_OAUTH_CALENDAR_REDIRECT_URI",
    authorizeUrl: "GOOGLE_OAUTH_AUTHORIZE_URL",
    tokenUrl: "GOOGLE_OAUTH_TOKEN_URL",
    revokeUrl: "GOOGLE_OAUTH_REVOKE_URL",
  },
  defaults: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    revokeUrl: "https://oauth2.googleapis.com/revoke",
  },
  scopes: ["https://www.googleapis.com/auth/calendar.events"],
  pkce: true,
  tokenAuth: "body",
  revokeStyle: "form_token",
  authorizeExtra: {
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
  },
  readEnv: (env = process.env) =>
    googleBaseEnv(env, "GOOGLE_OAUTH_CALENDAR_REDIRECT_URI", "GOOGLE_OAUTH_REDIRECT_URI"),
  parseAccount: parseGoogleAccount,
  notConfiguredDetail:
    "Google Calendar OAuth is not configured. Set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, and GOOGLE_OAUTH_CALENDAR_REDIRECT_URI (or GOOGLE_OAUTH_REDIRECT_URI). Nothing was started.",
};

const googleDriveProvider: OAuthProvider = {
  id: "google_drive",
  displayName: "Google Drive",
  envKeys: {
    clientId: "GOOGLE_OAUTH_CLIENT_ID",
    clientSecret: "GOOGLE_OAUTH_CLIENT_SECRET",
    redirectUri: "GOOGLE_OAUTH_DRIVE_REDIRECT_URI",
    authorizeUrl: "GOOGLE_OAUTH_AUTHORIZE_URL",
    tokenUrl: "GOOGLE_OAUTH_TOKEN_URL",
    revokeUrl: "GOOGLE_OAUTH_REVOKE_URL",
  },
  defaults: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    revokeUrl: "https://oauth2.googleapis.com/revoke",
  },
  scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  pkce: true,
  tokenAuth: "body",
  revokeStyle: "form_token",
  authorizeExtra: {
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
  },
  readEnv: (env = process.env) =>
    googleBaseEnv(env, "GOOGLE_OAUTH_DRIVE_REDIRECT_URI", "GOOGLE_OAUTH_REDIRECT_URI"),
  parseAccount: parseGoogleAccount,
  notConfiguredDetail:
    "Google Drive OAuth is not configured. Set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, and GOOGLE_OAUTH_DRIVE_REDIRECT_URI (or GOOGLE_OAUTH_REDIRECT_URI). Nothing was started.",
};

const slackProvider: OAuthProvider = {
  id: "slack",
  displayName: "Slack",
  envKeys: {
    clientId: "SLACK_OAUTH_CLIENT_ID",
    clientSecret: "SLACK_OAUTH_CLIENT_SECRET",
    redirectUri: "SLACK_OAUTH_REDIRECT_URI",
    authorizeUrl: "SLACK_OAUTH_AUTHORIZE_URL",
    tokenUrl: "SLACK_OAUTH_TOKEN_URL",
    revokeUrl: "SLACK_OAUTH_REVOKE_URL",
  },
  defaults: {
    authorizeUrl: "https://slack.com/oauth/v2/authorize",
    tokenUrl: "https://slack.com/api/oauth.v2.access",
    revokeUrl: "https://slack.com/api/auth.revoke",
  },
  scopes: ["channels:read", "chat:write", "users:read"],
  pkce: false,
  tokenAuth: "body",
  revokeStyle: "slack_auth_revoke",
  readEnv: (env = process.env) => ({
    clientId: trim(env, "SLACK_OAUTH_CLIENT_ID"),
    clientSecret: trim(env, "SLACK_OAUTH_CLIENT_SECRET"),
    redirectUri: trim(env, "SLACK_OAUTH_REDIRECT_URI"),
    authorizeUrl: trim(env, "SLACK_OAUTH_AUTHORIZE_URL") || "https://slack.com/oauth/v2/authorize",
    tokenUrl: trim(env, "SLACK_OAUTH_TOKEN_URL") || "https://slack.com/api/oauth.v2.access",
    revokeUrl: trim(env, "SLACK_OAUTH_REVOKE_URL") || "https://slack.com/api/auth.revoke",
  }),
  normalizeTokenJson: (json) => {
    if (json.ok === false) return json;
    if (typeof json.access_token === "string") return json;
    const authed = json.authed_user && typeof json.authed_user === "object" ? (json.authed_user as { access_token?: string }) : null;
    if (authed?.access_token) {
      return { ...json, access_token: authed.access_token, token_type: "bearer" };
    }
    return json;
  },
  parseAccount: (json) => {
    const team = json.team && typeof json.team === "object" ? (json.team as { name?: string; id?: string }) : null;
    const authed = json.authed_user && typeof json.authed_user === "object" ? (json.authed_user as { id?: string }) : null;
    return {
      workspaceName: team?.name,
      workspaceId: team?.id,
      accountLabel: authed?.id || team?.name || "Slack workspace",
    };
  },
  notConfiguredDetail:
    "Slack OAuth is not configured. Set SLACK_OAUTH_CLIENT_ID, SLACK_OAUTH_CLIENT_SECRET, and SLACK_OAUTH_REDIRECT_URI. Nothing was started.",
};

/** Slack v2 returns access_token at top-level for bot tokens; user tokens under authed_user.access_token */
export function slackAccessTokenFromResponse(json: Record<string, unknown>): string | undefined {
  if (typeof json.access_token === "string") return json.access_token;
  const authed = json.authed_user && typeof json.authed_user === "object" ? (json.authed_user as { access_token?: string }) : null;
  return authed?.access_token;
}

const githubProvider: OAuthProvider = {
  id: "github",
  displayName: "GitHub",
  envKeys: {
    clientId: "GITHUB_OAUTH_CLIENT_ID",
    clientSecret: "GITHUB_OAUTH_CLIENT_SECRET",
    redirectUri: "GITHUB_OAUTH_REDIRECT_URI",
    authorizeUrl: "GITHUB_OAUTH_AUTHORIZE_URL",
    tokenUrl: "GITHUB_OAUTH_TOKEN_URL",
    revokeUrl: "GITHUB_OAUTH_REVOKE_URL",
  },
  defaults: {
    authorizeUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    revokeUrl: undefined, // set dynamically with client id
  },
  scopes: ["repo", "read:user"],
  pkce: false,
  tokenAuth: "body",
  revokeStyle: "github_basic",
  readEnv: (env = process.env) => {
    const clientId = trim(env, "GITHUB_OAUTH_CLIENT_ID");
    return {
      clientId,
      clientSecret: trim(env, "GITHUB_OAUTH_CLIENT_SECRET"),
      redirectUri: trim(env, "GITHUB_OAUTH_REDIRECT_URI"),
      authorizeUrl: trim(env, "GITHUB_OAUTH_AUTHORIZE_URL") || "https://github.com/login/oauth/authorize",
      tokenUrl: trim(env, "GITHUB_OAUTH_TOKEN_URL") || "https://github.com/login/oauth/access_token",
      revokeUrl:
        trim(env, "GITHUB_OAUTH_REVOKE_URL") ||
        (clientId ? `https://api.github.com/applications/${clientId}/token` : undefined),
    };
  },
  parseAccount: (json) => ({
    accountLabel: typeof json.scope === "string" ? `GitHub · ${json.scope}` : "GitHub account",
  }),
  notConfiguredDetail:
    "GitHub OAuth is not configured. Set GITHUB_OAUTH_CLIENT_ID, GITHUB_OAUTH_CLIENT_SECRET, and GITHUB_OAUTH_REDIRECT_URI. Nothing was started.",
};

const notionProvider: OAuthProvider = {
  id: "notion",
  displayName: "Notion",
  envKeys: {
    clientId: "NOTION_OAUTH_CLIENT_ID",
    clientSecret: "NOTION_OAUTH_CLIENT_SECRET",
    redirectUri: "NOTION_OAUTH_REDIRECT_URI",
    authorizeUrl: "NOTION_OAUTH_AUTHORIZE_URL",
    tokenUrl: "NOTION_OAUTH_TOKEN_URL",
    revokeUrl: "NOTION_OAUTH_REVOKE_URL",
  },
  defaults: {
    authorizeUrl: "https://api.notion.com/v1/oauth/authorize",
    tokenUrl: "https://api.notion.com/v1/oauth/token",
  },
  scopes: [],
  pkce: true,
  tokenAuth: "basic",
  revokeStyle: "bearer_json",
  authorizeExtra: { owner: "user" },
  readEnv: (env = process.env) => ({
    clientId: trim(env, "NOTION_OAUTH_CLIENT_ID"),
    clientSecret: trim(env, "NOTION_OAUTH_CLIENT_SECRET"),
    redirectUri: trim(env, "NOTION_OAUTH_REDIRECT_URI"),
    authorizeUrl: trim(env, "NOTION_OAUTH_AUTHORIZE_URL") || "https://api.notion.com/v1/oauth/authorize",
    tokenUrl: trim(env, "NOTION_OAUTH_TOKEN_URL") || "https://api.notion.com/v1/oauth/token",
    revokeUrl: trim(env, "NOTION_OAUTH_REVOKE_URL"),
  }),
  parseAccount: (json) => {
    const workspaceName = typeof json.workspace_name === "string" ? json.workspace_name : undefined;
    const workspaceId = typeof json.workspace_id === "string" ? json.workspace_id : undefined;
    const botId = typeof json.bot_id === "string" ? json.bot_id : undefined;
    const owner = json.owner && typeof json.owner === "object" ? (json.owner as { user?: { name?: string; person?: { email?: string } } }) : null;
    const accountLabel = owner?.user?.person?.email || owner?.user?.name || undefined;
    return { workspaceName, workspaceId, botId, accountLabel };
  },
  notConfiguredDetail:
    "Notion OAuth is not configured. Set NOTION_OAUTH_CLIENT_ID, NOTION_OAUTH_CLIENT_SECRET, and NOTION_OAUTH_REDIRECT_URI. Nothing was started.",
};

export const OAUTH_PROVIDERS: Record<ConnectorId, OAuthProvider> = {
  notion: notionProvider,
  gmail: gmailProvider,
  google_calendar: googleCalendarProvider,
  google_drive: googleDriveProvider,
  slack: slackProvider,
  github: githubProvider,
};

/** Connectors served by the dynamic /api/mind/oauth/$connector/* routes (Notion keeps dedicated routes). */
export const DYNAMIC_OAUTH_CONNECTORS = [
  "gmail",
  "google_calendar",
  "google_drive",
  "slack",
  "github",
] as const satisfies readonly ConnectorId[];

export type DynamicOauthConnector = (typeof DYNAMIC_OAUTH_CONNECTORS)[number];

export function isDynamicOauthConnector(value: string): value is DynamicOauthConnector {
  return (DYNAMIC_OAUTH_CONNECTORS as readonly string[]).includes(value);
}

export function getProvider(id: ConnectorId): OAuthProvider {
  return OAUTH_PROVIDERS[id];
}
