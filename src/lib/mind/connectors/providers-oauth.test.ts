import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildConnectorAuthorizeUrl,
  connectorConnectionStatus,
  disconnectConnector,
  exchangeConnectorCode,
} from "./connector-oauth.ts";
import { getProvider } from "./providers.ts";
import { getAccessToken, setConnectorDirectory } from "./store.ts";
import { providerConfigured } from "./oauth-provider.ts";
import { resolveGoogleDriveAccessToken } from "./drive-token.ts";

const connectors = ["gmail", "google_calendar", "google_drive", "slack", "github"] as const;

describe("oauth providers beyond notion", () => {
  for (const connector of connectors) {
    describe(connector, () => {
      it(`${connector} reports not_configured when env is missing`, () => {
        const provider = getProvider(connector);
        assert.equal(providerConfigured(provider.readEnv({})), false);
        setConnectorDirectory(mkdtempSync(join(tmpdir(), `mind-oauth-${connector}-`)));
        const status = connectorConnectionStatus(connector, "owner", {});
        assert.equal(status.state, "not_configured");
        assert.match(status.detail, /not configured/i);
      });

      it(`${connector} builds authorize URL with state (and PKCE when supported)`, () => {
        setConnectorDirectory(mkdtempSync(join(tmpdir(), `mind-oauth-${connector}-`)));
        const provider = getProvider(connector);
        const env = {
          clientId: "client-id",
          clientSecret: "client-secret",
          redirectUri: `http://127.0.0.1:8099/api/mind/oauth/${connector}/callback`,
          authorizeUrl: provider.defaults.authorizeUrl,
          tokenUrl: "http://mock/token",
          revokeUrl: provider.defaults.revokeUrl || "http://mock/revoke",
        };
        const started = buildConnectorAuthorizeUrl(connector, { ownerId: "owner", env });
        assert.equal(started.ok, true);
        if (!started.ok) return;
        const url = new URL(started.url);
        assert.equal(url.searchParams.get("client_id"), "client-id");
        assert.equal(url.searchParams.get("response_type"), "code");
        assert.equal(url.searchParams.get("state"), started.state);
        assert.equal(url.searchParams.get("redirect_uri"), env.redirectUri);
        if (provider.pkce) {
          assert.ok(url.searchParams.get("code_challenge"));
          assert.equal(url.searchParams.get("code_challenge_method"), "S256");
        }
        if (provider.scopes.length) {
          assert.ok(url.searchParams.get("scope"));
        }
      });

      it(`${connector} exchanges code via mock token endpoint, stores encrypted, never leaks token`, async () => {
        setConnectorDirectory(mkdtempSync(join(tmpdir(), `mind-oauth-${connector}-`)));
        process.env.CONNECTOR_TOKEN_SECRET = "test-secret-for-unit";
        const provider = getProvider(connector);
        const env = {
          clientId: "client-id",
          clientSecret: "client-secret",
          redirectUri: `http://127.0.0.1:8099/api/mind/oauth/${connector}/callback`,
          authorizeUrl: provider.defaults.authorizeUrl,
          tokenUrl: "http://mock/token",
          revokeUrl: "http://mock/revoke",
        };
        const started = buildConnectorAuthorizeUrl(connector, { ownerId: "owner", env });
        assert.equal(started.ok, true);
        if (!started.ok) return;

        const fetchMock = async (_url: string, init?: RequestInit) => {
          const body = String(init?.body || "");
          assert.match(body, /grant_type=authorization_code/);
          assert.match(body, /code=auth-code/);
          if (provider.pkce) assert.match(body, /code_verifier=/);
          let payload: Record<string, unknown> = {
            access_token: `secret-${connector}-token`,
            token_type: "bearer",
            scope: provider.scopes.join(" "),
          };
          if (connector === "slack") {
            payload = {
              ok: true,
              access_token: `secret-${connector}-token`,
              token_type: "bot",
              team: { name: "E2E Slack", id: "T1" },
              authed_user: { id: "U1" },
            };
          }
          return {
            ok: true,
            status: 200,
            json: async () => payload,
            text: async () => "",
          };
        };

        const exchanged = await exchangeConnectorCode(connector, {
          code: "auth-code",
          state: started.state,
          env,
          fetch: fetchMock,
        });
        assert.equal(exchanged.ok, true);
        if (!exchanged.ok) return;
        assert.equal(exchanged.public.state, "connected");
        assert.equal(JSON.stringify(exchanged).includes(`secret-${connector}-token`), false);
        const token = getAccessToken("owner", connector);
        assert.equal(token, `secret-${connector}-token`);

        if (connector === "google_drive") {
          const resolved = resolveGoogleDriveAccessToken("owner");
          assert.equal(resolved.ok, true);
          if (resolved.ok) assert.equal(resolved.token, "secret-google_drive-token");
        }

        let revokeHits = 0;
        const revokeFetch = async (url: string, init?: RequestInit) => {
          revokeHits += 1;
          assert.match(url, /revoke|token|auth\.revoke/i);
          return {
            ok: true,
            status: 200,
            json: async () => ({ revoked: true }),
            text: async () => "",
          };
        };
        const after = await disconnectConnector(connector, { ownerId: "owner", env, fetch: revokeFetch });
        assert.ok(after.state === "not_connected" || after.state === "not_configured");
        assert.equal(getAccessToken("owner", connector), null);
        assert.ok(revokeHits >= 1);
      });
    });
  }
});
