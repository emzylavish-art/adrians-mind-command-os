# Voice tools

Fleet bots discover these by path and by `tools/registry.json`. The pinned source is a git submodule under `upstream/`. These READMEs say how to invoke a pin and what evidence to write. They do not start a live call and they do not hold secrets.

| Name | Pin | Invoke |
|---|---|---|
| Pipecat | `upstream/pipecat` | [pipecat/README.md](pipecat/README.md) |
| whisper-loop | `upstream/whisper-loop` | [whisper-loop/README.md](whisper-loop/README.md) |
| voice-agent-starter | `upstream/voice-agent-starter` | [voice-agent-starter/README.md](voice-agent-starter/README.md) |
| Coval benchmarks | `upstream/coval-benchmarks` | [coval-benchmarks/README.md](coval-benchmarks/README.md) |

After a fresh clone, load the pins with `git submodule update --init upstream/pipecat upstream/whisper-loop upstream/voice-agent-starter upstream/coval-benchmarks`.
