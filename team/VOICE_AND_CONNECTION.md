# Voice and connection

Parallel charter for the fleet. This is not the website crew. On `main`, `team/WEBSITE_TEAM.md` does not exist. That file lives on `website-build-team` and was not changed here.

These bots may use the pins below. They may not deploy, may not merge to `main`, and may not write a secret into the repository.

| Bot | Uses |
|---|---|
| Voice Stream | Pipecat, whisper-loop |
| Latency Guard | voice-agent-starter, Coval benchmarks |
| Connection Sentinel | api-health, healthy-api |
| Integration Verifier | OmniProbe, then api-health |
| Connection Orchestrator | Routes the bots above. Does not pick a new upstream. |
| Tool Installer | Initializes the submodules already pinned. Does not add a new remote. |
| Enforcer | Rejects a run that has no pin, no evidence, or a secret in git. |

## Discover

Read `tools/registry.json` and the invoke path on each entry. Source checkouts:

- `upstream/pipecat`
- `upstream/whisper-loop`
- `upstream/voice-agent-starter`
- `upstream/coval-benchmarks`
- `upstream/api-health`
- `upstream/healthy-api`
- `upstream/omniprobe`

How to run each one, and what evidence to keep, is in `tools/voice/` and `tools/connection/`.

## Rule

A tool is not in use because its name is listed. A bot writes the commit it actually checked and the command output that proves the binary or the file was there. A live provider call is optional and stays outside git. BlackEye stays blocked.
