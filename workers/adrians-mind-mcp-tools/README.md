# adrians-mind-mcp-test

Standalone nonproduction Worker. Origin:

`https://adrians-mind-mcp-test.operation-beat-magnus.workers.dev`

OAuth follows `team/oauth.py` and `team/mcp_http.py`: PKCE S256, scope `mind.tools`, authorization code, refresh rotation, and revocation. `/mcp` accepts only an OAuth access token from this worker's KV. There is no static bearer fallback.

KV binding `OAUTH_KV` must be a new namespace the parent creates, named `adrians-mind-mcp-test-oauth`. Do not reuse `adrians-mind-mcp-oauth`.

## Parent secrets

Set these in the Cloudflare secret store. Do not commit values.

- `MCP_OAUTH_SECRET`
- `MCP_OAUTH_CLIENT_ID`
- `MCP_OAUTH_REDIRECT_URIS` (comma-separated exact https callbacks)
- `OPENAI_API_KEY` and optional `ASTRA_API_KEY`, `SOL_API_KEY`, `LUNA_API_KEY`
- Optional models `ASTRA_MODEL`, `SOL_MODEL`, `LUNA_MODEL` (defaults `gpt-6-astra`, `gpt-6-sol`, `gpt-6-luna`)
- Optional `MIND_COMMAND_BUDGET_LIMIT_USD` and `MIND_COMMAND_BUDGET_SPENT_USD` (unset uses baseline 500 and 0)
- `MIND_COMMAND_BUDGET_OWNER_OVERRIDE=1` keeps the app cap from pausing

Non-secret Access vars in `wrangler.jsonc`:

- `MCP_TRUST_ACCESS_IDENTITY=1` enables verification. It does not trust `Cf-Access-Authenticated-User-Email`.
- `CF_ACCESS_TEAM_DOMAIN=adriansmind.cloudflareaccess.com`
- `CF_ACCESS_AUD=f3d3c26edffe9b02e90616706ed7622c3b96f80e7b1b43ef111eecbb72fdcd37`
- `CF_ACCESS_ALLOWED_EMAIL=emzylavish@gmail.com`

The JWT in `Cf-Access-Jwt-Assertion` must match issuer `https://adriansmind.cloudflareaccess.com`, that audience, expiry, and the RS256 signature from `https://adriansmind.cloudflareaccess.com/cdn-cgi/access/certs`. The email claim must be the allowed owner. A forged email header, `X-Authenticated-User`, or `MCP_OAUTH_DEV_SUBJECT` does not issue a code. Access application `0758718a-6b44-4414-b3e2-07ae13659679` is the verified gate in front of `/oauth/authorize`.

Public client id is `adrians-mind-mcp-test`. The redirect is this host's `/oauth/test-callback`, so `MCP_OAUTH_REDIRECT_URIS` is not required. `MCP_OAUTH_SECRET` and `OAUTH_KV` still are.

This worker only calls `https://api.openai.com/v1/chat/completions`. Other base URLs are not configured.

## Harness

Start URL:

`https://adrians-mind-mcp-test.operation-beat-magnus.workers.dev/oauth/test-start`

That request stores the PKCE verifier in `OAUTH_KV` and redirects to `/oauth/authorize`. It does not send `prompt=login`, so an Access session from the last hour can continue without a new OTP. After login, the callback exchanges the code in KV, then `fetch`es `POST https://adrians-mind-mcp-test.operation-beat-magnus.workers.dev/mcp` for `initialize`, `tools/list`, and `tools/call` `provider.status`. The bearer is not sent to any other URL. `global_fetch_strictly_public` makes that same-host fetch a public subrequest. The issued token is revoked before the result is stored.

The earlier harness called `handleRequest` inside the Worker. That was not a public HTTPS `/mcp` call. This bundle does not use that fallback. A result is `ok` only when all three HTTP statuses are 200 and `tools/call` has `isError` not true. `external_network_verified` stays false in the payload. Unit tests inject `fetch` and do not prove the live network. After this bundle is deployed, rerun the start URL and read `fetch_path: "global_fetch"` plus the three `http_status` values. `provider.status` does not call OpenAI. The result JSON has no authorization code, access token, or API key.

## Upload

Bundle: `workers/adrians-mind-mcp-tools/bundle/index.js`

Metadata: `workers/adrians-mind-mcp-tools/bundle/metadata.json`

Replace `namespace_id` with the new test namespace before upload. Do not deploy from this repository session.
