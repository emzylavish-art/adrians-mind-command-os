# Typed chat HTTP 400 — handoff (Voice Integration → owning lanes)

**Status:** Diagnosed on voice-integration worktree; **not fixed here** (out of voice lock).  
**Owners:** XAI Verification lane (inference-key resolution); Logic Bot / Merge Gate for `turn.server.ts` / `agent-run.server.ts` (logic-wiring @ `beebc80` rewired chat timeouts).  
**When:** 2026-11-01 Africa/Lagos

## Root cause (reproduced)

Sandbox / process env often has **`XAI_API_KEY` identical to `XAI_MANAGEMENT_KEY`** (Cloud Agent inject). Management keys are rejected by Grok chat:

- Request (representative): `POST https://api.x.ai/v1/chat/completions` with Bearer = process `XAI_API_KEY` (= management)
- Response: **HTTP 400** `{"code":"invalid-argument","error":"Incorrect API key provided. ..."}`

Evidence saved (no secrets): `/workspace/voice-test/text-turn-root-cause-mgmt-key.json`

The box inference secret file **`/home/box/.secrets/xai_inference.env`** holds a real chat key (`export XAI_API_KEY=…`, len 84). When that key is used, chat returns **200**. Live app turn after loading inference env: `POST /api/mind/turn` → **200** SSE (`event: delta` / `done`).

So the “typed message 400” is **not** a request-schema / model-id mismatch from voice UI; it is **wrong key in process env** (management masquerading as inference).

## Proposed patch (for owning lane — do not land on voice-integration)

1. Add server-only helper (suggested path: `src/lib/mind/xai-inference-key.ts`) that:
   - Reads `/home/box/.secrets/xai_inference.env` (`export XAI_API_KEY=` supported)
   - **Overrides** `process.env.XAI_API_KEY` when the file is present
   - If file missing and `XAI_API_KEY === XAI_MANAGEMENT_KEY`, **clears** `XAI_API_KEY` so chat fails closed with “not configured” instead of Grok 400
2. Call `resolveXaiInferenceApiKey(process.env)` from `completeModelReply` / `handleMindTurn` / agent-run chat paths (**rebase onto logic-wiring `beebc80`** before editing `turn.server.ts`).
3. Optional: surface Grok error body in the `Grok returned ${status}` message (read `error` from JSON once).
4. Regression test: when env has management key as `XAI_API_KEY` and inference secrets file exists, resolved key is the file key (never log the value).
5. Preview launch: load voice env then **inference env last** so `XAI_API_KEY` is the chat key (`scripts/voice/dev-preview.sh` / with-app-env).

Voice Integration dropped local edits to `turn.server.ts`, `agent-run.server.ts`, `server.ts` (grok status), and the new inference-key module so Merge Gate is not blocked by a cross-lane collision.

## Captures

- Request body used: `/workspace/voice-test/text-turn-request.json`
- Successful turn body (after correct key): `/workspace/voice-test/text-turn-response.body`
- Mgmt-key 400 probe: `/workspace/voice-test/text-turn-root-cause-mgmt-key.json`
