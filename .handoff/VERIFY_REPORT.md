# VERIFY_REPORT — Adrian's Mind Command OS, logic-wiring-queue @ 1a10c22

Date: 2026-11-02T22:47:58-06:00 (America/Chicago)

## Scope
298efed: provider failover fallback now receives the SAME assembled context the primary got. Before: when the primary (xAI) failed before any text streamed, runFallback sent the fallback provider only the latest user message — no system/persona prompt, no memory notes, no history — while the done event still echoed usedIds as if notes were used. Now: turn.server passes `prepared.assembled.messages` (assembleTurn output, the primary's own builder) to runFallback; provider-call flattens it for text-only providers (`toTextOnlyMessages`) and builds provider-specific bodies (`buildProviderRequestBody`: OpenAI/OpenRouter messages; Anthropic top-level system + alternating turns; Gemini systemInstruction + user/model contents). Prior-turn image parts become a text stub (no data-URL/base64 forwarded); current-turn images still never fail over (server gate + runFallback defense in depth). Provider response read cap raised from 4000 chars so long replies are not cut mid-JSON into an "empty reply" failure.
1a10c22: adversarial review — 5 extra tests, no code defects found.

## PASS / FAIL
- PASS: OpenAI fallback body = primary messages exactly (system with Adrian's Mind prompt + [note-1] memory note, user/assistant history, current turn, same order).
- PASS: Anthropic: system in top-level `system`, no system role in messages, starts with user, roles alternate, leading assistant history kept.
- PASS: Gemini: systemInstruction carries notes; contents user/model/user; leading assistant handled; key only in query string, never in JSON body.
- PASS: Memory OFF → fallback gets the same "Memory is OFF" line and no notes.
- PASS: history with image parts → no data:image/base64/image_url in any provider payload; "cannot see" stub present; text kept.
- PASS: current turn with image parts → refused, zero outbound calls (even if a caller bypasses the server gate).
- PASS: no primary/provider key and no primary error text/URL in the fallback request body.
- PASS: max-size history (12 × 8000) sent intact = primary truncation; over-budget context drops OLDEST history first, system + current turn always kept.
- PASS: 12k-char fallback reply returned whole (old 4000-char body cut made it fail).
- PASS: malformed messages (unknown role, object content, blank) → honest refusal, no outbound call; history cannot forge a system role.
- PASS: relay e2e — Grok 503 → fallback sees notes + history; done names openai; resolvedTier not claimed; usedIds truthful; double failure → one scrubbed error, no done.
- PASS: legacy non-Grok primary prompt path unchanged (4000-char cap); all prior failover guarantees (abort, no failover after streaming, scrubbed errors, OFF surfaces error) still green.
- PASS: model-agnostic (no Grok model names added to tiers/UI); no nav/drawer, Notion status card, voice/attachment/media/visual files touched; no key material in diff.

## Known limits (not failures)
- Failover sends memory notes and history to the fallback provider (a different vendor) — by design, only when the user turned failover on.
- Non-Grok primary still sends only the latest user text (its Grok failover gets full context); giving the non-Grok primary the shared builder is a separate task.
- Anthropic fallback keeps max_tokens 400 and does not report max_tokens truncation.
- Non-Grok primary failing over to Grok spends two chat rate-limit tokens.
- No live production verification (no secondary provider key on server; no deploy per rules).

## Gates
tsc clean; test:mind 1859/1859; test:scripts 205 pass 0 fail 4 skipped; build green.

## Verdict
PASS
