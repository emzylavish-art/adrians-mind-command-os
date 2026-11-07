# whisper-loop

Low-latency local loop: streaming faster-whisper STT, a streaming LLM, and per-sentence TTS. Barge-in cancels the LLM request and the audio that is already playing.

- Canonical name: whisper-loop
- Upstream: https://github.com/aryeo0908/whisper-loop
- Pin: `upstream/whisper-loop` at `810e1d5d410557038d1379cd709e3fb979422bde`
- License: MIT
- Registry name: `whisper-loop`

## Invoke

```bash
git -C upstream/whisper-loop rev-parse HEAD
test -f upstream/whisper-loop/server/pyproject.toml
test -f upstream/whisper-loop/server/app
```

The server is `upstream/whisper-loop/server`. Copy `server/.env.example` to an untracked `.env` on the machine, not into git. Start only when that file exists outside the repository.

## Environment names

`LLM_PROVIDER`, `BEDROCK_REGION`, `BEDROCK_MODEL_ID`, `OLLAMA_HOST`, `OLLAMA_MODEL`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_BASE_URL`, `STT_MODEL`, `STT_DEVICE`, `STT_COMPUTE_TYPE`, `HF_HOME`, `TTS_VOICE`, `TTS_MODELS_DIR`, `HOST`, `PORT`, `LOG_LEVEL`, `AGENT_NAME`, `WAKE_WORD_ENABLED`. AWS keys, when used, come from `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` or the local AWS profile. Never commit values.

## Evidence

Record the pin, the `LLM_PROVIDER` name (not the key), and the first-token time the server printed. If barge-in was not exercised, say so.

## Rollback

`git submodule deinit -f upstream/whisper-loop && git rm -f upstream/whisper-loop`, then remove the registry, bootstrap, and catalog rows.
