# Voice round 3 — Direct Speaking regression (2026-11-01 Africa/Lagos)

## Root cause
`speakText` queued a Direct reply while `responseBusy` was true (captureOnly auto-reply cancel), but `response.done` called `completeSpeak()` without flushing `speakQueue`, so `force_message` never sent → UI stayed on Listening with transcript only.

## Fix
- On `response.done`: always `flushSpeakQueue()` after clearing busy.
- `speakText`: set `pendingForce` first; recover stranded speakQ; queue while busy.
- Named clips: `expectedTranscriptForTestAudio` — `hello`→`hello`, `question`→`What time is it?`; dictation uses canned (no STT overwrite); realtime overrides STT + commit inject with same labels.
- `hello.wav` regenerated as short beep; original speech content kept as `question.wav`.
- During test-audio speak, mute input briefly; echo-guard 900ms.

## Proof
- Unit: `speak-after-busy.test.ts` PASS
- Headless repro: Getting session → Listening → Thinking → Speaking (~1.7s) with transcript `hello`
- URLs: `http://127.0.0.1:8091/?voiceTestAudio=hello` and `?voiceTestAudio=question`
