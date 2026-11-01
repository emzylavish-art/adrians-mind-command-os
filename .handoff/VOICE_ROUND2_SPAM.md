# Voice Integration — round 2 + mic-spam hardening (2026-11-01 Africa/Lagos)

## Fixes (a–c)
1. **Dictation + `?voiceTestAudio=`** — skips silent fake mic; inserts canned/STT transcript from same test source (`dictationTranscriptForTestAudio` / `fetchVoiceTestAudioBlob`).
2. **Orchestrator** — probes Ollama **before** mic/session; fail-fast overlay error; **re-probes on hydrate** when stored mode is Orchestrator (hint survives reload).
3. **Mic preflight** — `enumerateDevices` → immediate “No microphone found”; maps NotAllowed/NotFound/NotReadable (`mic-probe.ts`).
4. **Barge-in** — `BARGE_IN_ECHO_GUARD_MS` so TTS cannot self-trigger; `SPEAKING_MIN_VISIBLE_MS` for Interrupt affordance; server VAD `speech_started` only after guard.

## Spam hardening (d)
Module `spam-guard.ts` (+ session wiring):
1. **Single-flight** connect (`beginFlight` / `endFlight`) — mash open/close does not stack connects.
2. **Mute idempotent** (`nextMuteState`); interrupt/cancel **budget** (`CANCEL_BUDGET_MAX` / window) — continuous noise cannot endless-cancel.
3. **EchoCancellation / noiseSuppression / autoGainControl** on getUserMedia; RMS cancel also budgeted + echo-guard.
4. **Transcript dedupe** TTL; **speak queue** coalesce overlapping `force_message`.
5. **WS drop** mid-session → `onError` with Retry copy; intentional `close()` suppressed.
6. **Secret expiry** helper `secretNeedsRemint` (+ skew); expiresAt captured after mint.

## Tests / URLs
- Unit: spam-guard, mic-probe, barge-in, test-audio, mode, connection-stages, realtime-session — **pass**.
- E2E: `npm run test:voice-e2e` → `/workspace/voice-test/e2e-results.json` (partial under RAM pressure).
- Preview: `http://127.0.0.1:8091/`
- Direct: `http://127.0.0.1:8091/?voiceTestAudio=hello`
- Dictation test: same URL → mic → Stop → composer insert.
- Orchestrator: toggle mode (no test audio) → overlay should error on Ollama before mic timeout.

## Out of scope
- Typed-chat 400 / inference key (XAI Verification). Do not touch `turn.server.ts` / `agent-run.server.ts`.
