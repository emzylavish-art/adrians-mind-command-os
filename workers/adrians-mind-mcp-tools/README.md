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

Issuer and audience are non-secret vars in `wrangler.jsonc`. `MCP_TRUST_ACCESS_IDENTITY=1` requires `Cf-Access-Authenticated-User-Email`. `X-Authenticated-User` is ignored. `MCP_OAUTH_DEV_SUBJECT` is ignored unless `MCP_ENV=development`, which this config does not set.

This worker only calls `https://api.openai.com/v1/chat/completions`. Other base URLs are not configured.

## Auth test without skipping OAuth

Put Cloudflare Access in front of the hostname, then:

1. `GET /.well-known/oauth-protected-resource`
2. `GET /oauth/authorize` with the Access email header, `response_type=code`, the registered client and redirect, `scope=mind.tools`, and PKCE S256.
3. `POST /oauth/token` as `application/x-www-form-urlencoded` with the code and verifier.
4. `POST /mcp` with `Authorization: Bearer <access_token>` and `tools/call` name `provider.status`.

`provider.status` does not call OpenAI. Without the Access email, authorize returns 401 `login_required`. A wrong bearer on `/mcp` returns 401. Missing KV or OAuth secrets return 503 `oauth_unconfigured`.

## Upload

Bundle: `workers/adrians-mind-mcp-tools/bundle/index.js`

Metadata: `workers/adrians-mind-mcp-tools/bundle/metadata.json`

Replace `namespace_id` with the new test namespace before upload. Do not deploy from this repository session.
