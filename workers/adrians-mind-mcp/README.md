# adrians-mind-mcp

Production Worker. Do not upload this onto `adrians-mind`, `gpt-mcp-proxy`, `operation-beat-magnus-trigger`, or `adrians-mind-mcp-test`.

Origin: `https://adrians-mind-mcp.operation-beat-magnus.workers.dev`

Access app `c595be3c-82f3-424d-a7b0-605a81e3a0cd` protects only `/oauth/authorize`. Policy `74790e6f-ca8f-4702-b8eb-6107440a15e1` is the owner email OTP, one hour.

KV binding `OAUTH_KV` is namespace `adrians-mind-mcp-production-oauth`, id `fef303f6f09149469c711cda6f4ef943`.

Public client `adrians-mind-mcp`. Callback `https://adrians-mind-mcp.operation-beat-magnus.workers.dev/oauth/callback`.

Parent sets these five secrets by the official Cloudflare API. No values belong in this repo:

- `MCP_OAUTH_SECRET`
- `OPENAI_API_KEY`
- `ASTRA_API_KEY`
- `SOL_API_KEY`
- `LUNA_API_KEY`

## Harness

No generation: `https://adrians-mind-mcp.operation-beat-magnus.workers.dev/oauth/start`

That path calls only `initialize`, `tools/list`, and `provider.status`.

One generation, after the parent writes the ledger:

```bash
npx wrangler kv key put --namespace-id fef303f6f09149469c711cda6f4ef943 audit:model.generate:once '{"phase":"authorized"}'
```

Then open `https://adrians-mind-mcp.operation-beat-magnus.workers.dev/oauth/start?generation=once`

The worker writes `phase: attempted` before `model.generate` and `phase: completed` after. A second visit does not call it again. Prompt is `Reply with OK`, `provider: auto`, `stream: false`. Do not seed `attempted` or `completed` yourself or the call is skipped.
