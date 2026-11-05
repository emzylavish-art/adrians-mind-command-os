# Coval benchmarks

Continuous public benchmarks for speech-to-text, text-to-speech, and speech-to-speech. Latency Guard uses this for time-to-first-audible, word error rate, and voice-to-voice latency.

- Canonical name: Coval benchmarks
- Upstream: https://github.com/coval-ai/benchmarks
- Pin: `upstream/coval-benchmarks` at `7b4e5583fb720f503c467222c2ff447e48138a50`
- License: Apache-2.0
- Registry name: `Coval benchmarks`

## Free-tier entry

Read https://benchmarks.coval.ai with no account and no environment variable. That page is the free entry. Do not scrape it into the git history.

A local rerun is optional. Copy `upstream/coval-benchmarks/.env.example` to an untracked `.env` and set only the provider you intend to measure.

## Environment names

None are required to read the public leaderboard. A local rerun uses the `*_API_KEY` names already listed in `upstream/coval-benchmarks/.env.example`, including `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`, `DEEPGRAM_API_KEY`, and `XAI_API_KEY`. Never commit values.

## Invoke

```bash
git -C upstream/coval-benchmarks rev-parse HEAD
test -f upstream/coval-benchmarks/README.md
test -f upstream/coval-benchmarks/.env.example
```

Follow `upstream/coval-benchmarks/README.md` before a local run. The smoke command above does not call a provider.

## Evidence

Quote the leaderboard date you read, the model, and the metric (TTFA, TTFS, WER, or voice-to-voice). If you only checked the pin, say `leaderboard-not-read`.

## Rollback

`git submodule deinit -f upstream/coval-benchmarks && git rm -f upstream/coval-benchmarks`, then remove the registry, bootstrap, and catalog rows.
