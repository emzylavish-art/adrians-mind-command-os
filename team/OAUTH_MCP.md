# OAuth + MCP MVP

`team/mcp_http.py` is the authenticated resource server. It exposes the
manifest-backed tools at `POST /mcp` and the OAuth metadata and authorization
code endpoints when `MCP_OAUTH_ISSUER` is configured. The transport accepts
JSON-RPC `initialize`, `notifications/initialized`, `tools/list`, and
`tools/call`; malformed JSON-RPC is rejected before the runner is called.

The original Grokbot MCP remains at `mcp/gpt_proxy_server.py` and is registered
as `gpt-proxy` in `.mcp.json`. It preserves its existing `ask_gpt` and
`generate_image` tools and inherits credentials from the host. The earlier
Cloudflare API MCP profile is preserved there as `cloudflare-api`; Adrian’s
Mind does not replace either existing server.

## Local development

```bash
export MCP_AUTH_TOKEN='local-only-token'
export MCP_ENV=development
export MCP_OAUTH_ISSUER=https://mcp.example.test
export MCP_OAUTH_AUDIENCE=https://mcp.example.test/mcp
export MCP_OAUTH_SECRET='local-secret-from-a-secret-manager'
export MCP_OAUTH_CLIENT_ID=adrians-mind-dev
export MCP_OAUTH_REDIRECT_URIS=https://client.example.test/callback
export MCP_OAUTH_DEV_SUBJECT=owner@example.test
python team/mcp_http.py
```

The development subject is an explicit local test switch. Production must set
`MCP_TRUST_ACCESS_IDENTITY=1`, put the service behind Cloudflare Access, and
pass only its verified identity header; never enable `MCP_OAUTH_DEV_SUBJECT` in
production. Configure the Worker with
the same issuer/audience, a durable KV-backed code/token store, and a secret
binding for the signing/storage key. The repository does not change the
production `gpt-mcp-proxy` Worker or Access policies.

## Astra, Sol, and Luna routing

`model.generate` accepts `provider: "auto"`, which attempts configured routes
in this order: Astra, Sol, then Luna. The provider is recorded in the result;
the code never claims a model was used unless its HTTP request returned a valid
response. Each external route requires an endpoint, API key, and model supplied
through secret/runtime bindings:

```text
ASTRA_API_BASE_URL ASTRA_API_KEY ASTRA_MODEL
SOL_API_BASE_URL   SOL_API_KEY   SOL_MODEL
LUNA_API_BASE_URL  LUNA_API_KEY  LUNA_MODEL
```

For an OpenAI-compatible API proxy, the three routes may share
`OPENAI_API_BASE_URL` and `OPENAI_API_KEY`; keep the three model names explicit
in `ASTRA_MODEL`, `SOL_MODEL`, and `LUNA_MODEL`. The standalone `openai` route
accepts `OPENAI_MODEL` as an exact model identifier. No alias is treated as
available until the configured API actually accepts the request.

No Astra/Sol/Luna endpoint or model identifier is invented by the code. Paid
routes still require the existing budget preflight variables. `stream: true`
requests the OpenAI-compatible SSE form and reassembles text deltas; it remains
unverified against the user's external provider until a real endpoint is bound.

## Cloudflare deployment boundary

Use a preview Worker or a separate service for validation. The Python runner
cannot execute inside a Worker, so host `team/mcp_http.py` (or an equivalent
HTTP bridge) separately and protect it with a service credential. The Worker
should proxy only `/mcp`, preserve the bearer token, and use HTTPS. Add KV
storage for authorization codes, refresh/access token hashes, expiry, and
revocation before production. Required production checks are discovery,
redirect allowlisting, PKCE S256, Access identity, audience/scope enforcement,
and an end-to-end authenticated `tools/call`.
