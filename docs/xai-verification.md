# xAI verification (controlled live)

Date: 2026-11-01 (Africa/Lagos, UTC+1)
Branch: `xai-verification`
Stop point: **complete** (typed-chat 400 regression fixed)

## Root cause (typed chat HTTP 400)

- Process env often has `XAI_API_KEY` **identical** to `XAI_MANAGEMENT_KEY` (len 90). Management keys are rejected by inference (`GET /v1/models` and chat → **400** Incorrect API key).
- Inference key lives at `/home/box/.secrets/xai_inference.env` (len 84) and returns **200** on models-list.
- On `main` / `logic-wiring` / most worktrees, typed chat reads `process.env.XAI_API_KEY` directly in:
  - `src/lib/mind/turn.server.ts` (`completeModelReply`, `handleMindTurn`)
  - `src/lib/mind/agent-run.server.ts`
  - `src/lib/mind/server.ts` (grok configured flag)
- So Send/typed chat used the management key → 400.

## Fix (this branch)

- `resolveXaiInferenceApiKey()` in `src/lib/mind/xai-adapter.ts`:
  1. Loads `/home/box/.secrets/xai_inference.env` (overrides process env)
  2. Refuses a key equal to `XAI_MANAGEMENT_KEY` → `unavailable` / `misconfigured_management_key` (no fabricate)
- Wired into `turn.server.ts`, `agent-run.server.ts`, `server.ts`
- `scripts/with-app-env.mjs` applies inference secrets before spawning Vite
- `startup.sh` unsets stale `XAI_API_KEY` then sources the secrets file
- Regression tests: env holds management key (with and without secrets file)

## Key storage / load

- Stored: `/home/box/.secrets/xai_inference.env` (`export XAI_API_KEY=…`, chmod 600) — outside git
- Key id (from mint): `0922b6a4-e716-4e29-9b40-a1b9ee217964` name `Adrian's Mind inference` redacted `xai-...IA44`
- ACLs: `api-key:endpoint:chat`, `api-key:endpoint:models`, `api-key:model:*`

## Live typed-chat path (exactly one chat call)

- Path: `relayModelStream` (same as `handleMindTurn` after auth)
- Models listed first (14); chosen `grok-4.5`
- Before resolve: process key equals management = true
- After resolve: equals management = false
- Response: `VERIFY-OK`
- Latency: 978 ms
- Request id: `452dfd76-56f0-9cf8-b76d-7b32e5653a2a`
- Usage: prompt 501 / completion 3

## Persistence

- Byte-for-byte match: true
- sha256: `7d18b48ff73e9b7672256fc0fdb82543568351810874ea4fbe49fae8cc0d061e`
- length: 9

## Missing-key

- Isolated env + no secrets file → `unavailable` / `missing_key`; no fetch; nothing persisted

## Rebase onto logic-wiring

- logic-wiring tip (as of this write) still uses raw `process.env.XAI_API_KEY` and also imports `chatTurnTimeoutMs` / `CHAT_TIMEOUT_REPLY` from `./turn-timeouts` (Voice handoff cited `beebc80`).
- This branch does **not** yet include `turn-timeouts`. When merging/rebasing:
  - Keep logic-wiring timeout wiring on `relayModelStream({ timeoutMs: chatTurnTimeoutMs(), ... })`
  - Replace raw `process.env.XAI_API_KEY` reads with `resolveXaiInferenceApiKey(process.env)`
  - Add `src/lib/mind/xai-adapter.ts` (+ tests) and the `with-app-env` / `startup.sh` secrets load
- Expected conflict hotspots: `turn.server.ts` key + timeout hunks; `agent-run.server.ts` key block; `package.json` test list

## Other worktrees

Until they merge this branch (or cherry-pick the adapter + turn/agent/server/startup/with-app-env changes), they still pick up the management key for typed chat if their server process inherited box env. Running servers (e.g. voice `:8095`, dashboard `:8100`/`:8110`) need restart **after** those trees get the fix or after launching via a script that sources `xai_inference.env` (voice-wiring `scripts/voice/dev-preview.sh` already does).
