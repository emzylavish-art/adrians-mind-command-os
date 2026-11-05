# Pipecat

Primary voice backbone: microphone audio to streaming speech-to-text, to an LLM, to streaming speech-to-text's reverse (text-to-speech), with barge-in.

- Canonical name: Pipecat
- Upstream: https://github.com/pipecat-ai/pipecat
- Pin: `upstream/pipecat` at `de8998789d5690073ddd1dafcec7268839af8153`
- License: BSD-2-Clause
- Registry name: `Pipecat`

## Invoke

Do not import this into the website build. A bot confirms the pin, then runs an example only in a local environment that already has keys outside git.

```bash
git -C upstream/pipecat rev-parse HEAD
test -f upstream/pipecat/pyproject.toml
```

A pipeline example lives under `upstream/pipecat/examples/`. Read that example's own README before running it. The framework itself needs no key to be present.

## Environment names

None are required to verify the pin. A running bot reads names from `upstream/pipecat/env.example`. The speak path usually needs `DAILY_API_KEY`, `DAILY_ROOM_URL`, plus one STT key, one LLM key, and one TTS key named in that file. Never write the values into the repo.

## Evidence

Write the commit printed by `rev-parse`, the example path you ran, and whether barge-in cancelled both the LLM stream and the audio. If you did not run a live pipeline, say `not-run`.

## Rollback

`git submodule deinit -f upstream/pipecat && git rm -f upstream/pipecat`, then remove the Pipecat rows from `tools/registry.json`, `tools/bootstrap/upstream-sources.json`, the bootstrap script, and this catalog entry.
