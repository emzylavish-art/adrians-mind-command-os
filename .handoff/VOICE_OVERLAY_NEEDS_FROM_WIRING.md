# Voice Overlay → Wiring needs (Orchestrator TTS after long Ollama wait)

**Owner context:** Voice Integration Bot · branch `voice-integration` · 2026-11-02 (America/Chicago)

## Symptom we hit

In the Command OS overlay (`RealtimeVoiceSession` in `src/lib/mind/voice/`), Orchestrator mode:

1. Realtime STT / injected `voiceTestAudio=question` transcript reaches the Ollama conductor fine.
2. Ollama (`qwen2.5:0.5b` locally) replies in ~15–25s.
3. Calling `speakText` → `conversation.item.create` + `force_message` marks **Speaking** locally but yields **zero** `response.output_audio.delta` / `response.audio.delta` bytes on the open realtime socket.
4. Direct mode (force_message ~2.5s after connect) still gets realtime TTS deltas.

WS around the failed force path showed only `ping` + benign `Cancellation failed: no active response found` — no audio deltas after the long idle gap.

## Overlay fix (this lane — do not revert casually)

Orchestrator replies now go through **xAI HTTP `/v1/tts`** via `speakOrchestratorReply` in `command-app.tsx` (still real xAI speech + overlay Speaking / Interrupt). Realtime stays capture-only for STT. Direct still uses realtime `force_message`.

## Ask for Voice Wiring (`src/lib/mind/voice-live/`)

`LiveVoiceSession.speakForce` uses the same `force_message` shape **without** an HTTP fallback. Live Orchestrator turns that wait on local Ollama will likely hit the same silent-Speaking failure after a long gap.

Please consider one of:

1. HTTP `/v1/tts` (or shared `SharedAudioOutput` MPEG path) fallback when no audio delta arrives within ~2s of `speakForce`, or
2. A realtime keepalive / short `session.update` during the Ollama wait so `force_message` still emits PCM, or
3. Documented guidance that Wiring Orchestrator must not rely on `force_message` after multi-second conductor latency.

We did **not** edit `voice-live/` in this lane.

## Evidence

`/workspace/voice-test/final-e2e-2/g-orchestrator-roundtrip.*` — transcript + Ollama notice + Speaking + HTTP TTS bytes; Direct regression still green with realtime TTS bytes.
