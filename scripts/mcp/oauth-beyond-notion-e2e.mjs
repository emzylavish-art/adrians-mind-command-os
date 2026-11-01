#!/usr/bin/env node
/**
 * Honest OAuth e2e beyond Notion (local mock token/revoke endpoints):
 * For each of gmail, google_calendar, google_drive, slack, github:
 *   not_configured → authorize → callback exchange → Connected → Disconnect → Not connected
 * Log: /workspace/audit/mcp-integration/oauth-beyond-notion-e2e.log
 * Live provider connects stay UNVERIFIED unless real client creds are in env.
 */
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const AUDIT = "/workspace/audit/mcp-integration";
mkdirSync(AUDIT, { recursive: true });
const lines = [];
const log = (line) => {
  const row = `[${new Date().toISOString()}] ${line}`;
  lines.push(row);
  console.log(row);
};

const root = process.cwd();
const CONNECTORS = ["gmail", "google_calendar", "google_drive", "slack", "github"];

async function main() {
  process.env.CONNECTOR_TOKEN_SECRET = "e2e-beyond-notion-secret";
  const dir = mkdtempSync(join(tmpdir(), "mind-oauth-beyond-"));
  const store = await import(pathToFileURL(join(root, "src/lib/mind/connectors/store.ts")).href);
  const oauth = await import(pathToFileURL(join(root, "src/lib/mind/connectors/connector-oauth.ts")).href);
  const providers = await import(pathToFileURL(join(root, "src/lib/mind/connectors/providers.ts")).href);
  const drive = await import(pathToFileURL(join(root, "src/lib/mind/connectors/drive-token.ts")).href);
  store.setConnectorDirectory(dir);

  let tokenHits = 0;
  let revokeHits = 0;
  const mock = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks).toString("utf8");
    if (req.url === "/token" && req.method === "POST") {
      tokenHits += 1;
      log(`mock token hit body=${body.slice(0, 180)}`);
      const isSlack = body.includes("client_id=e2e-slack");
      res.writeHead(200, { "content-type": "application/json" });
      if (isSlack) {
        res.end(
          JSON.stringify({
            ok: true,
            access_token: "e2e-slack-token",
            token_type: "bot",
            team: { name: "E2E Slack", id: "T-E2E" },
            authed_user: { id: "U-E2E" },
          }),
        );
      } else {
        res.end(
          JSON.stringify({
            access_token: "e2e-access-token",
            token_type: "bearer",
            scope: "mock.scope",
            refresh_token: "e2e-refresh",
          }),
        );
      }
      return;
    }
    if ((req.url === "/revoke" || req.url?.startsWith("/applications/")) && (req.method === "POST" || req.method === "DELETE")) {
      revokeHits += 1;
      log(`mock revoke hit method=${req.method} url=${req.url}`);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ revoked: true }));
      return;
    }
    res.writeHead(404);
    res.end("no");
  });
  await new Promise((r) => mock.listen(0, "127.0.0.1", r));
  const { port } = mock.address();
  const tokenUrl = `http://127.0.0.1:${port}/token`;
  const revokeUrl = `http://127.0.0.1:${port}/revoke`;

  log(`cwd=${root}`);
  log(`connector dir=${dir}`);
  log(`mock token url=${tokenUrl}`);

  // Live creds check — never scrape; only report env presence
  const liveKeys = [
    "GOOGLE_OAUTH_CLIENT_ID",
    "SLACK_OAUTH_CLIENT_ID",
    "GITHUB_OAUTH_CLIENT_ID",
  ];
  for (const key of liveKeys) {
    const present = Boolean(process.env[key]?.trim());
    log(`live env ${key}: ${present ? "PRESENT (live connect still UNVERIFIED in this mock e2e)" : "absent"}`);
  }

  for (const connector of CONNECTORS) {
    log(`--- ${connector} ---`);
    const provider = providers.getProvider(connector);
    const missing = oauth.connectorConnectionStatus(connector, "user-1", {});
    log(`${connector} not_configured: state=${missing.state}`);
    if (missing.state !== "not_configured") throw new Error(`${connector} expected not_configured`);

    const env = {
      clientId: connector === "slack" ? "e2e-slack" : `e2e-${connector}`,
      clientSecret: "e2e-secret",
      redirectUri: `http://127.0.0.1:8080/api/mind/oauth/${connector}/callback`,
      authorizeUrl: provider.defaults.authorizeUrl,
      tokenUrl,
      revokeUrl: connector === "github" ? `http://127.0.0.1:${port}/applications/e2e-github/token` : revokeUrl,
    };

    const started = oauth.buildConnectorAuthorizeUrl(connector, { ownerId: "user-1", env });
    log(`${connector} start ok=${started.ok}`);
    if (!started.ok) throw new Error(started.error);
    const url = new URL(started.url);
    log(
      `${connector} authorize client_id=${url.searchParams.get("client_id")} state=${url.searchParams.get("state")} pkce=${url.searchParams.get("code_challenge_method") || "none"} scope=${url.searchParams.get("scope") || ""}`,
    );

    const exchanged = await oauth.exchangeConnectorCode(connector, {
      code: `e2e-code-${connector}`,
      state: started.state,
      env,
    });
    log(`${connector} exchange ok=${exchanged.ok} public=${JSON.stringify(exchanged.ok ? exchanged.public : exchanged)}`);
    if (!exchanged.ok) throw new Error(exchanged.error);
    if (JSON.stringify(exchanged).includes("e2e-access-token") || JSON.stringify(exchanged).includes("e2e-slack-token")) {
      throw new Error(`${connector}: token leaked to public result`);
    }

    const connected = oauth.connectorConnectionStatus(connector, "user-1", env);
    log(`${connector} connected state=${connected.state} detail=${connected.detail}`);
    if (connected.state !== "connected") throw new Error(`${connector} expected connected`);

    if (connector === "google_drive") {
      const resolved = drive.resolveGoogleDriveAccessToken("user-1");
      log(`google_drive resolveDrive ok=${resolved.ok} (token never logged)`);
      if (!resolved.ok) throw new Error(resolved.error);
    }

    const after = await oauth.disconnectConnector(connector, { ownerId: "user-1", env });
    log(`${connector} disconnect state=${after.state} detail=${after.detail}`);
    if (after.state === "connected") throw new Error(`${connector} still connected after disconnect`);
  }

  log(`tokenHits=${tokenHits} revokeHits=${revokeHits}`);
  if (tokenHits < CONNECTORS.length) throw new Error("expected one token hit per connector");
  if (revokeHits < CONNECTORS.length) throw new Error("expected one revoke hit per connector");

  log("RESULT=PASS mocked=true live=UNVERIFIED");
  mock.close();
  writeFileSync(join(AUDIT, "oauth-beyond-notion-e2e.log"), lines.join("\n") + "\n");
}

main().catch((err) => {
  log(`RESULT=FAIL error=${err instanceof Error ? err.message : String(err)}`);
  writeFileSync(join(AUDIT, "oauth-beyond-notion-e2e.log"), lines.join("\n") + "\n");
  process.exit(1);
});
