# xAI verification (controlled live)

Date: 2026-11-01 (Africa/Lagos, UTC+1)
Branch: `xai-verification`

## Adapter

- Found existing xAI chat path in `src/lib/mind/relay.ts` and `src/lib/mind/turn.server.ts` (`https://api.x.ai/v1/chat/completions`, `XAI_API_KEY`).
- Added minimal shared adapter: `src/lib/mind/xai-adapter.ts` (missing-key → `unavailable`, never fabricates).
- Orchestrator/PGLite persistence path: `applyAgentTurn` → `writeSnapshot` / `readSnapshot` (`src/lib/mind/store.ts`) on file PGLite.

## Live call (exactly one)

- Models list (`GET /v1/models`) and one chat completion were attempted with the environment `XAI_API_KEY` present (`xai-` prefix, length 90).
- API response: HTTP 400 `invalid-argument` / "Incorrect API key provided."
- No retry after the API error. No response text, request id, or token usage available.
- Model requested for the chat probe: `grok-4-fast-non-reasoning` (key rejected before model execution mattered). Code default remains `grok-4.5`.
- Script for a future opted-in call: `MIND_LIVE_XAI=1 node --experimental-strip-types scripts/verify-xai.mjs`

## Persistence read-back

- Live reply was not persisted (API error → nothing stored as a model reply).
- Local PGLite round-trip via the verification script confirmed byte-for-byte match for a fixture string (`VERIFY-OK-LOCAL`) using sha256 + length.

## Missing-key path

- `env` without `XAI_API_KEY` (or empty) returns `state: unavailable`, `reason: missing_key`.
- No network fetch, no fabricated text, and `shouldStoreReply` stays false.

## Locks

- `/workspace/locks` existed with `rea-feature-hunter.lock` (paths under `rea-captures/` and planned `docs/rea/` only). No lock on xAI verification files.
- No `locks` directory inside the repo.
