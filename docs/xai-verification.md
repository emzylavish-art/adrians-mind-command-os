# xAI verification (controlled live)

Date: 2026-11-01 (Africa/Lagos, UTC+1)
Branch: `xai-verification`
Stop point: **complete**

## Key creation and storage

- Minted via Management API `POST /auth/teams/{teamId}/api-keys` using `XAI_MANAGEMENT_KEY`.
- Team ID: `c5078e86-a42f-4f3c-93d9-be513103966b`
- Key id: `0922b6a4-e716-4e29-9b40-a1b9ee217964`
- Name: `Adrian's Mind inference`
- Redacted: `xai-...IA44`
- ACLs: `api-key:endpoint:chat`, `api-key:endpoint:models`, `api-key:model:*` (inference/chat + models list only; no image/voice/etc.)
- Propagation: all listed clusters `true`
- **Stored at (not in git):** `/home/box/.secrets/xai_inference.env` as `export XAI_API_KEY=…` (dir `0700`, file `0600`)
- Meta (no secret): `/home/box/.secrets/xai_inference_meta.json`
- **Loaded by:** `applyXaiInferenceSecrets()` in `src/lib/mind/xai-adapter.ts` (secrets file is authoritative when present). Wired from `turn.server.ts`, `server.ts`, and `agent-run.server.ts`. Template: `.env.example` (placeholder only).

## Adapter / persistence path

- Adapter: `src/lib/mind/xai-adapter.ts` (+ existing `relay.ts` / `turn.server.ts`)
- Persist: `applyAgentTurn` → `writeSnapshot` / `readSnapshot` (`store.ts`) on file PGLite
- Script: `MIND_LIVE_XAI=1 node --experimental-strip-types scripts/verify-xai.mjs`

## Live call (exactly one chat completion)

- Models listed first (14); chosen `grok-4.5`
- Response text: `VERIFY-OK`
- Latency: `1146` ms
- Usage: prompt_tokens `501`, completion_tokens `3`
- Request id: `8311fb70-341a-9631-9fa0-ed0521e6f6b5`

## Persistence read-back

- Byte-for-byte match: **true**
- sha256: `7d18b48ff73e9b7672256fc0fdb82543568351810874ea4fbe49fae8cc0d061e`
- length: `9`

## Missing-key path

- Isolated env + absent secrets path → `state: unavailable`, `reason: missing_key`
- No network fetch, no fabricated text, nothing persisted as a model reply

## Earlier stop (superseded)

- First attempt used the box `XAI_API_KEY` which matched the management key and was rejected by the inference API (`400 incorrect API key`). That was the previous stop point before minting this inference key.

## Locks

- `/workspace/locks` had unrelated bots (`error-banners` released, `voice-wiring` on other paths). No lock on xAI verification files. No repo `locks/` dir.
