# Voice Integration — stop point (2026-11-01 Africa/Lagos)

**Branch:** `voice-integration` @ worktree `/workspace/mind-command-os-voice-integration`  
**Preview:** `http://127.0.0.1:8091/` (dev); Direct test URL `/?voiceTestAudio=hello`  
**Complete:** **no** (overlay Speaking/Interrupt e2e still flaky under OOM; typed-chat 400 fix deferred cross-lane)

## Done this pass

1. **Voice mode badge persistence** — `commitVoiceMode` writes `amcos.voice.mode.v1` before state; hydrate-only effect (no SSR default write-back). Tests in `mode.test.ts`. E2E check `badge_persists_orchestrator` **pass**.
2. **Connection stages + 10s timeouts + Retry** — `connection-stages.ts`; overlay status/error/Retry; soft ignore benign cancel errors; barge-in Interrupt; `speakingRef` so user VAD does not false-trigger Interrupted.
3. **Dev `?voiceTestAudio=`** — `test-audio.ts` + bundled `public/voice-test/hello.wav`; capture-only feed + canned Speaking fallback for Direct headless.
4. **Playwright e2e** — `scripts/voice/e2e-voice-clickthrough.mjs`, npm `test:voice-e2e` → `/workspace/voice-test/e2e-results.json` (dictation + Orchestrator hint + badge persist green; overlay round-trip crashed page when RAM contested).
5. **Typed chat 400** — **diagnosed, not committed.** Root cause: process `XAI_API_KEY` === management key → Grok **400 Incorrect API key**. Fix belongs to XAI Verification / `turn.server.ts` owners. See `.handoff/TYPED_CHAT_400_HANDOFF.md`. Dropped local edits to `turn.server.ts`, `agent-run.server.ts`, `server.ts` grok-status, and `xai-inference-key*` per lock collision steering.

## Not complete

- Full Direct overlay e2e green (Speaking + Interrupt) under shared-box memory pressure
- Landing inference-key resolution in turn path (other lanes)
- Marking voice-integration complete / releasing lock until overlay e2e + merge gate

## Avoid

- `styles.css` / `voice-ui/` (visual polish)
- `turn.server.ts` / `agent-run.server.ts` / inference-key module (logic / XAI Verification)
