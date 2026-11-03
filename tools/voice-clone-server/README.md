# Adrian's Mind — local voice-clone server (Zack's PC)

Implements `docs/voice-cloning/local-endpoint.md`.

**Do not download Qwen (~18 GB) or cloning weights on the agent box.** Zack installs them on his own machine.

Research pick (2026-11-03): `/workspace/research/voice-cloning-models-2026-11.md`

| Rank | Backend env | Model | License | VRAM | Download (approx) | Watermark |
|------|-------------|-------|---------|------|-------------------|-----------|
| 1 (default) | `chatterbox` | Chatterbox (Resemble AI) | MIT / MIT | ~4 GB | ~3.2 GB (`ResembleAI/chatterbox`) | **PerTh** (on) |
| 2 | `cosyvoice3` | Fun-CosyVoice3-0.5B | Apache-2.0 | ~8 GB | ~9.7 GB (`FunAudioLLM/Fun-CosyVoice3-0.5B-2512`) | none built-in |
| test | `mock` | Deterministic tone | n/a | n/a | 0 | off |

## Setup on Zack's PC

```bash
cd tools/voice-clone-server
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### Chatterbox (default / primary)

```bash
# Install the Chatterbox / Resemble package for your CUDA/CPU stack (see ResembleAI/chatterbox).
# Example name — confirm against current README on GitHub/HF before installing:
#   pip install chatterbox-tts
# Download weights (~3.2 GB practical) from Hugging Face:
#   ResembleAI/chatterbox
export VOICE_CLONE_BACKEND=chatterbox
uvicorn app:app --host 127.0.0.1 --port 7860
```

Zero-shot from ~5–10 s of reference audio. Synthesized audio carries the **PerTh** perceptual watermark — the Studio surfaces this in the provider banner.

### Fun-CosyVoice3-0.5B (secondary)

```bash
# Follow FunAudioLLM CosyVoice install docs (torch, matching CUDA wheels).
# Weights (~9.7 GB): FunAudioLLM/Fun-CosyVoice3-0.5B-2512
# Official FastAPI server may be used instead of this wrapper; keep the same /health /voices /tts /voices/{id} contract if you proxy it.
export VOICE_CLONE_BACKEND=cosyvoice3
uvicorn app:app --host 127.0.0.1 --port 7860
```

Supports save/delete speaker profiles (`add_zero_shot_spk` / `save_spkinfo` in upstream).

### Mock (Studio e2e only — mock-verified, not a real clone)

```bash
export VOICE_CLONE_BACKEND=mock
uvicorn app:app --host 127.0.0.1 --port 7860
```

## Point Adrian's Mind at the engine

```bash
export VOICE_CLONE_PROVIDER=local
export VOICE_CLONE_LOCAL_URL=http://127.0.0.1:7860
export VOICE_QWEN_URL=http://127.0.0.1:11434   # Qwen / Ollama orchestrator — install later
```

## Qwen orchestrator

Qwen (~18 GB) is the **last** step on Zack's PC. Reuse the existing Orchestrator/Ollama conductor in `src/lib/mind/voice/`. Studio TTS for cloned voices goes through this engine's `POST /tts`. An MCP server wrapping the contract is **future docs only**.

## Security

Bind `127.0.0.1` only. App rejects non-loopback URLs unless `VOICE_CLONE_ALLOW_REMOTE=1`.
