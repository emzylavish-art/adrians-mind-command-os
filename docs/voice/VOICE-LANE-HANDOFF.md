# Adrian's Mind — Voice lane handoff

Dated living doc for **all** voice work (not only cloning). Product name: **Adrian's Mind** / **Adrian's Mind Command OS**. Never write "Edurain".

## Branches / tips

| Lane | Branch | Notes |
|------|--------|-------|
| Voice Wiring (live bar, Direct/Orchestrator) | `voice-wiring` | Tip historically `6b464f0` for always-on composer live voice; worktree `/workspace/mind-command-os-voice` |
| Voice Cloning Studio | `voice-cloning-studio` | This lane — hub + studio |
| Whisper Flow | `whisper-flow` | Owned by **Voice Integration Bot** — dictation/STT UX; relate only, do not edit |
| Visual Polish (studio skin) | cherry-picked `eeba5fe` → local tip `57f988f` on `voice-cloning-studio` | Scoped CSS under `[data-testid="voice-cloning-studio"]`; hooks `data-vcs-state`, `.vcs-empty`, `.vcs-badge`; Create profile contrast fix. Visual polish integrated with hub wiring in the following hub commit. |

## Architecture (cloning)

Studio → **Voice Connection Hub (MCP)** → one-file adapters → engines.

See `docs/voice-cloning/hub-architecture.md` and `docs/voice-cloning/local-endpoint.md`.

Adapters shipped: `chatterbox-local` (default), `cosyvoice3-local`, `elevenlabs`, `mcp-proxy`, `generic-http`, `xai` (disabled/unsupported), `mock` (tests).

## Non-cloning voice features (existing)

- Live Speak pill / call bar (`voice-live`, `live-voice-bar`) — Voice Wiring
- Dictation / Whisper Flow (xAI STT `grok-voice-transcribe-2.0`) — Voice Integration; separate from Studio
- Builtin TTS voices (`voices.ts` allowlist) + `SharedAudioOutput` speaker path
- Orchestrator mode → local Ollama/Qwen conductor (`ollama-conductor.ts`); Qwen (~18 GB) installs on Zack's PC last; studio cloning TTS goes through the **same hub**

## Consent / profiles / export / delete

- Attestation + random code phrase including **Adrian's Mind** + STT verify
- Server consent record; hub requires consent token on `create_voice`
- Public-figure name blocklist
- Export MP3/WAV + consent JSON; fails after delete
- Verifiable delete (profile, sample, consent, provider voice)

## Model pick (2026-11-03)

Research: `/workspace/research/voice-cloning-models-2026-11.md`

- **Primary:** Chatterbox (Resemble) — MIT, ~3.2 GB download, ~4 GB VRAM, PerTh watermark
- **Secondary:** Fun-CosyVoice3-0.5B — Apache-2.0, ~9.7 GB, ~8 GB VRAM, official FastAPI + speaker profiles

## MCP option

The Voice Connection Hub **is** the MCP server for cloning. A future optional MCP exposing Studio orchestration tools beyond the hub is documented only — not built as a second stack.

## Audits

- Grok Build baseline path (historical folder name): `/workspace/audit/edurain-baseline/AUDIT.md`
- Studio audit: `/workspace/audit/voice-cloning-studio/AUDIT.md`

## Next justified task (Zack)

1. On his PC: install Qwen (~18 GB) + Chatterbox weights (`ResembleAI/chatterbox`).
2. Run `tools/voice-clone-server` with `VOICE_CLONE_BACKEND=chatterbox`.
3. Run Voice Hub + Studio against real `/health` → create → synth (PerTh on).
4. Do **not** install those models on the agent box.

## Notion

Standing rule: append progress **only** to handoff page `40b1aa27632381768d58cde0731f142a`. If it 404s, report — do not use the mirror.


## Attacker pass + Playwright (MOCK-VERIFIED)

- Unit attacker suite: `src/lib/mind/voice-cloning/attacker-pass.test.ts` (profile/consent/generate/export through hub mock).
- Playwright: `scripts/voice/vcs-e2e-mock-hub.mjs` on a free port (not 8080/8095); screenshots under `/workspace/voice-test/vcs-e2e-*.png`.
- Hardening: magic-byte audio sniff, homoglyph public-figure fold, WAV/MP3 export header checks, consent JSON omits `consentCode`, preview objectURL revoke on stop/unmount/profile switch.
- Still pending Zack’s PC: real Chatterbox/CosyVoice3 weights + Qwen. Vercel tip may show Ignored Build Step.
