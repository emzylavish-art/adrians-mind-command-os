# adrians-mind-mcp

Production Worker. Do not upload this onto `adrians-mind`, `gpt-mcp-proxy`, `operation-beat-magnus-trigger`, or `adrians-mind-mcp-test`.

Origin: `https://adrians-mind-mcp.operation-beat-magnus.workers.dev`

Access app `c595be3c-82f3-424d-a7b0-605a81e3a0cd` protects only `/oauth/authorize`. Policy `74790e6f-ca8f-4702-b8eb-6107440a15e1` is the owner email OTP, one hour.

KV binding `OAUTH_KV` is namespace `adrians-mind-mcp-production-oauth`, id `fef303f6f09149469c711cda6f4ef943`.

Public client `adrians-mind-mcp`. Callback `https://adrians-mind-mcp.operation-beat-magnus.workers.dev/oauth/callback`.

The production bundle exposes `provider.status`, `model.generate`, and `visual.analyze`. `visual.analyze` accepts an HTTPS image URL or `data:image` URL plus a prompt, uses Astra first and Sol as fallback, and never routes visual work to Luna. The image is sent to the configured OpenAI-compatible provider; the worker does not fetch or persist it.

Parent sets these five secrets by the official Cloudflare API. No values belong in this repo:

- `MCP_OAUTH_SECRET`
- `OPENAI_API_KEY`
- `ASTRA_API_KEY`
- `SOL_API_KEY`
- `LUNA_API_KEY`

## Harness

No generation: `https://adrians-mind-mcp.operation-beat-magnus.workers.dev/oauth/start`

That path calls only `initialize`, `tools/list`, and `provider.status`. `provider.status` includes `credential_lengths` for `OPENAI_API_KEY`, `ASTRA_API_KEY`, `SOL_API_KEY`, and `LUNA_API_KEY`. Each value is a character count. The response has no key text, prefix, or hash. Compare those counts with the 164-character source keys before arming a retest.

The consumed key `audit:model.generate:once` stays completed. Do not delete or rewrite it.

One new generation, only after lengths are confirmed and this separate key is written:

`audit:model.generate:retest-1` = `{"phase":"authorized"}`

Then open `https://adrians-mind-mcp.operation-beat-magnus.workers.dev/oauth/start?generation=retest-1`

No other `generation` value runs a model call. The worker writes `attempted` on `audit:model.generate:retest-1` before `model.generate` and `completed` after it. A second visit does not call it again. Prompt is `Reply with OK`, provider `auto`, stream false. Auto routing stops at the first success, so an earlier 401 attempt does not prove the later providers.
