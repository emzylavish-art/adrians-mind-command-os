# Adrian's Mind — Voice Connection Hub (MCP)

The Studio talks **only** to this hub. Engines are one-file adapters under `adapters/`.

## Tools

- `list_providers`
- `health` (`provider_id?`)
- `create_voice` (requires `consent_token` + `consent_record_id` from Studio)
- `synthesize`
- `delete_voice`
- `list_voices`

## Run (local stdio)

```bash
# from repo root, with node_modules present
node --experimental-strip-types tools/voice-mcp-hub/src/server.ts
```

Env:

- `VOICE_HUB_DEFAULT_PROVIDER=chatterbox-local`
- `VOICE_HUB_ENABLED=chatterbox-local,cosyvoice3-local,mock,...`
- `VOICE_HUB_CONSENT_SECRET=...`
- `VOICE_CLONE_LOCAL_URL=http://127.0.0.1:7860` (HTTP adapters)
- `ELEVENLABS_API_KEY=...` (optional; never print)
- `VOICE_MCP_PROXY_URL=...` (optional external MCP)

## Add a provider

1. Create `adapters/my-engine.ts` exporting `createAdapter(env)`.
2. Add id to `registry.json` `enabled` (or `VOICE_HUB_ENABLED`).
3. No core edits. Pass the shared conformance tests.

See `docs/voice-cloning/hub-architecture.md`.
