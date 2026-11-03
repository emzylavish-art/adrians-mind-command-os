#!/usr/bin/env node
/**
 * Honest OAuth e2e (local mock token endpoint):
 * start authorize → callback exchange → Connected → Disconnect → Not connected
 * Log: /workspace/audit/mcp-integration/oauth-e2e.log
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

async function main() {
  process.env.CONNECTOR_TOKEN_SECRET = "e2e-connector-secret";
  const dir = mkdtempSync(join(tmpdir(), "mind-oauth-e2e-"));
  const store = await import(pathToFileURL(join(root, "src/lib/mind/connectors/store.ts")).href);
  const oauth = await import(pathToFileURL(join(root, "src/lib/mind/connectors/notion-oauth.ts")).href);
  store.setConnectorDirectory(dir);

  // Mock token (+ optional revoke) server
  let tokenHits = 0;
  let revokeHits = 0;
  const mock = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks).toString("utf8");
    if (req.url === "/token" && req.method === "POST") {
      tokenHits += 1;
      log(`mock token hit body=${body.slice(0, 200)}`);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          access_token: "e2e-access-token",
          token_type: "bearer",
          workspace_name: "E2E Workspace",
          workspace_id: "ws-e2e",
          owner: { user: { name: "E2E User", person: { email: "e2e@example.com" } } },
        }),
      );
      return;
    }
    if (req.url === "/revoke" && req.method === "POST") {
      revokeHits += 1;
      log(`mock revoke hit`);
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

  const env = {
    clientId: "e2e-client",
    clientSecret: "e2e-secret",
    redirectUri: "http://127.0.0.1:8080/api/mind/oauth/notion/callback",
    authorizeUrl: "https://api.notion.com/v1/oauth/authorize",
    tokenUrl,
    revokeUrl,
  };

  log(`cwd=${root}`);
  log(`connector dir=${dir}`);
  log(`mock token url=${tokenUrl}`);

  // Missing env → not_configured
  const missing = oauth.notionConnectionStatus("user-1", {});
  log(`not_configured check: state=${missing.state} detail=${missing.detail}`);

  const started = oauth.buildNotionAuthorizeUrl({ ownerId: "user-1", env });
  log(`start ok=${started.ok} url=${started.ok ? started.url : started.error}`);
  if (!started.ok) throw new Error(started.error);

  const url = new URL(started.url);
  log(`authorize params: client_id=${url.searchParams.get("client_id")} state=${url.searchParams.get("state")} pkce=${url.searchParams.get("code_challenge_method")}`);

  const before = oauth.notionConnectionStatus("user-1", env);
  log(`before callback: state=${before.state}`);

  const exchanged = await oauth.exchangeNotionCode({ code: "e2e-code", state: started.state, env });
  log(`exchange ok=${exchanged.ok} public=${JSON.stringify(exchanged.ok ? exchanged.public : exchanged)}`);
  if (!exchanged.ok) throw new Error(exchanged.error);
  if (JSON.stringify(exchanged).includes("e2e-access-token")) throw new Error("token leaked to public result");

  const connected = oauth.notionConnectionStatus("user-1", env);
  log(`connected status: ${JSON.stringify(connected)}`);
  const raw = store.getAccessToken("user-1", "notion");
  log(`server-side token present=${Boolean(raw)} value_redacted=${raw ? "[redacted len=" + raw.length + "]" : "null"}`);

  const disconnected = await oauth.disconnectNotion({ ownerId: "user-1", env });
  log(`disconnect: ${JSON.stringify(disconnected)} revokeHits=${revokeHits}`);
  const after = oauth.notionConnectionStatus("user-1", env);
  log(`after disconnect: ${JSON.stringify(after)}`);
  log(`tokenHits=${tokenHits}`);

  // Credential scan (names only)
  const names = Object.keys(process.env).filter((k) => /NOTION_OAUTH|GOOGLE_.*CLIENT|GMAIL_.*CLIENT/i.test(k));
  log(`box env oauth-related keys present: ${names.length ? names.join(",") : "(none)"}`);
  log("live provider connect: UNVERIFIED — no real NOTION_OAUTH_CLIENT_ID/SECRET found on box env (did not read other apps/browsers/connectors).");

  mock.close();
  writeFileSync(join(AUDIT, "oauth-e2e.log"), lines.join("\n") + "\n");
  log(`wrote ${join(AUDIT, "oauth-e2e.log")}`);
  if (connected.state !== "connected" || after.state !== "not_connected" || tokenHits < 1) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  writeFileSync(join(AUDIT, "oauth-e2e.log"), lines.concat([String(err?.stack || err)]).join("\n") + "\n");
  process.exit(1);
});
