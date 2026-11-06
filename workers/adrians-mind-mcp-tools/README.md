# adrians-mind-mcp-tools

Free Cloudflare Worker MCP entrypoint. It does not modify `adrians-mind`, `gpt-mcp-proxy`, or `operation-beat-magnus-trigger`.

Authenticated tools:

- `model.generate` — `POST https://api.openai.com/v1/chat/completions` only
- `mind.tool_inventory` — local category list, no network call

Static bearer auth uses the Worker secret `MCP_AUTH_TOKEN`. `OPENAI_API_KEY` is also a Worker secret. Neither value belongs in this repo or in wrangler vars.

Usage is returned on that single response. There is no KV binding, so usage is not durable. Provider billing allowance is unknown. Live account access is not verified by these tests.

## Deploy (parent)

From this directory, on the free Workers plan:

```bash
npx wrangler secret put MCP_AUTH_TOKEN
npx wrangler secret put OPENAI_API_KEY
npx wrangler deploy
```

Expected hostname, if the account subdomain stays `operation-beat-magnus.workers.dev`:

`https://adrians-mind-mcp-tools.operation-beat-magnus.workers.dev`

Checks:

- `GET /health` is public and reports whether secrets are present, not their values.
- `POST /mcp` without `Authorization: Bearer <MCP_AUTH_TOKEN>` returns 401.
- Do not add a route, KV, D1, R2, AI, Queues, or Durable Objects binding.

Optional non-secret variable: `OPENAI_MODEL`, used only when a call omits `model`.

`model.generate` input: `{ "prompt" }` or `{ "messages": [{ "role", "content" }] }`, optional `model`, `stream`, `timeout_seconds` 1..20. `provider` must be omitted or `"openai"`.
