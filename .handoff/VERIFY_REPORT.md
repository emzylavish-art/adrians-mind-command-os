# VERIFY_REPORT — logic-wiring @ 6b28e6a (H14)

- **Tip verified:** `6b28e6a` (H14: cut-off SSE never reports done; honest HTTP status on turn failures)
- **Verifier:** Logic Bot (independent, adversarial; re-tested live, did not trust build step)
- **When:** 2026-11-03 00:07 WAT (Africa/Lagos)
- **Preview:** two `vite dev --strictPort` servers on random free 127.0.0.1 ports, `VITE_AUTH_ENABLED=false`, no DATABASE_URL (dev-user). `XAI_API_KEY` loaded server-side from secrets file, never printed. Both servers killed after.
  - main: default env
  - alt: `MIND_MODEL_ORCHESTRATOR=grok-nonexistent-h14`, `MIND_MODEL_HEAVY=<secret-shaped xai-…>`, fake `OPENAI_API_KEY`
- Prior LOW bugs from b6f7620 report (non-Grok skipped rate limit; selectProvider failure 200): **confirmed fixed** (unit: provider-http.test.ts; live rows 9–10 below).

## PASS / FAIL

| # | Check | Result | Notes |
|---|-------|--------|-------|
| 1 | Live Fast/Expert/Heavy/Build/Orchestrator | **PASS** | done.model = grok-4.20-0309-non-reasoning / grok-4.5 / grok-4.7 / grok-build-0.1 / grok-4.7; resolvedTier matches |
| 2 | Auto short → Fast; missing tier + code prompt → Auto→Build | **PASS** | |
| 3 | modelTier `__proto__`/`constructor`/`toString`/`hasOwnProperty`/`auto`/`"Orchestrator "`/123/true/[..]/{..} on /api/mind/turn | **PASS** | all 400 "Unknown model tier", no stream |
| 4 | Same tiers on /api/mind/agent | **PASS** | 400, empty log |
| 5 | Raw JSON `__proto__` / `constructor` keys | **PASS** | 400 |
| 6 | Bad MIND_MODEL_ORCHESTRATOR id (live xAI) | **PASS** | SSE error "That model is not available…", no done → chip cannot advertise it |
| 7 | Secret-shaped MIND_MODEL_HEAVY | **PASS** | ignored → grok-4.7; never echoed |
| 8 | Grok-path failures not 200 (NEW fix) | **PASS** | empty text 400, bad memory 400, halted 409 |
| 9 | Provider selection: unknown 400, openai w/o key 503, no Grok substitute | **PASS** | |
| 10 | Non-Grok rate limit shares chat bucket | **PASS** | 2 Grok + 10 openai = 12 tokens, then 429 + Retry-After 58 |
| 11 | Non-Grok upstream failure not 200 (NEW fix) | **PASS** | fake key → 502 (harness row mis-counted the shared bucket; statuses correct) |
| 12 | Cut-off SSE (clean close, no [DONE]/finish_reason) → error, no done (NEW fix) | **PASS (unit)** | truncation-honesty.test.ts; cannot force xAI to truncate live |
| 13 | Key leak grep: response bodies, both vite logs, tsc/build logs, tracked repo files | **PASS** | clean (real key + both fake secrets) |
| CI | tsc / npm test / build | **PASS** | tsc 0; mind 367/0 + scripts 198/0; build 0 |

**Overall tip verdict:** **PASS**

## Bugs ranked

1. **MEDIUM (fixed in 6b28e6a)** — provider stream closing at a frame boundary without `[DONE]`/`finish_reason` was emitted as `done` (partial reply saved as success, chip showed the model). Now "Grok's reply was cut off…" error; `readModelPayload` also returns empty for unterminated SSE.
2. **LOW (fixed in 6b28e6a)** — Grok-path validation/halt/model-unavailable failures and non-Grok upstream failures returned HTTP 200.
3. **LOW (open, out of this cycle)** — `command-app.tsx` `setLastResolvedTier` ignores `Orchestrator`, so a stale Auto→X resolved tier can persist; cosmetic since chip uses selected tier for non-Auto. File is claimed by other lanes; not touched.
4. **OPEN (process)** — origin/main is 655 commits ahead; trial merge conflicts in 15 logic files (turn.server, model-tiers, request-body, research, limits, agent-run, tests). Merge aborted cleanly; needs a dedicated merge cycle.
