# Voice Integration Bot — local handoff mirror
Notion page https://app.notion.com/p/40bb95f33e42814aacf8c3281b4f528d used (Error Banners Bot mirror page in connected workspace).

## 2026-11-01T12:03:11+01:00 — Voice Integration Bot — end-to-end voice
- Lane: voice-integration / worktree /workspace/mind-command-os-voice-integration
- Base: voice-wiring f2f6b60
- Commits: feaae3f, 1625912, 6362940, 6314004
- Works: capture-only STT via realtime (auto-reply cancelled) → Direct/Orchestrator → force_message/TTS speak; real level waveform; mute; secrets-file voice key; docs-correct client_secrets
- Live verified: client_secrets 200; TTS 200/91724 bytes; STT 200 "Say hello in one word."; capture-only+force 45600 PCM bytes. See /workspace/voice-test/integration-verify.json
- Mocked/blocked: Ollama unreachable (honest); browser mic not headless-tested; visual polish CSS untouched
- Tests: typecheck pass; 222/222 mind tests; build pass; scripts/** .grok/skills/og pre-existing fail
- Notion: appended to page 40bb95f3-3e42-814a-acf8-c3281b4f528d (Error Banners Bot mirror page)
