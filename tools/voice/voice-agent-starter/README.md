# voice-agent-starter

Reference voice agent for Latency Guard. This pin is the LiveKit Agents Python starter (`livekit-examples/agent-starter-python`), the closest maintained starter with per-stage timing fields. It is not named `voice-agent-starter` upstream. There was no healthy repository under that exact name that also published a per-stage budget.

- Canonical name: voice-agent-starter
- Upstream: https://github.com/livekit-examples/agent-starter-python
- Pin: `upstream/voice-agent-starter` at `228095c442fcb259c80e9786fc0d7c5534e6af46`
- License: MIT
- Registry name: `voice-agent-starter`

## What to measure

The starter does not hard-code millisecond targets. LiveKit Agent Observability, which this starter is built to emit, splits a turn into:

- end-to-end latency
- LLM time to first token
- TTS time to first byte

Compare those three fields across runs. Do not invent a fourth number and call it measured.

## Invoke

```bash
git -C upstream/voice-agent-starter rev-parse HEAD
test -f upstream/voice-agent-starter/pyproject.toml
test -f upstream/voice-agent-starter/.env.example
```

Run the starter only with keys outside git. See the upstream README for the process command.

## Environment names

`LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`. Never commit values.

## Evidence

Record the pin and the three metric names above, with the numbers only if a real session printed them. A presence check alone is evidence of the pin, not of latency.

## Rollback

`git submodule deinit -f upstream/voice-agent-starter && git rm -f upstream/voice-agent-starter`, then remove the registry, bootstrap, and catalog rows.
