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
| Tool Installer | Initiates the submodules already pinned. Does not add a new remote. |
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

## Mandatory pre-merge checklist

Before any merge to `main` or any deploy to production, the merger must complete every item below. Skipping any item is a defect, not a shortcut.

1. List every open branch under the `fleet/` prefix and the `chatgpt/` prefix. Record branch name, last commit SHA, last commit date, and ahead/behind relative to `main`.
2. For each open branch, state one of three outcomes: merged into the candidate, explicitly deferred with the reason written, or abandoned with the reason written. No branch may be left unaccounted for.
3. Confirm `fleet/integration/candidate` contains every verified bot change that is meant to ship. If a bot's work is missing from the candidate, it is not shipped — it is tracked as an open gap.
4. Run the full test suite on the candidate branch. Record the command and the output. A failing check blocks the merge.
5. Confirm Integration Verifier's latest evidence is fresh (same cycle as the merge request) and shows pass for every connection and provider in scope.
6. Confirm Error Bot's latest report shows zero unresolved P0 or P1 items.
7. Confirm no production credentials, API keys, tokens, or secrets appear in any diff being merged.
8. Only after items one through seven are written down does a human or Astra make the final go-live decision. No bot may self-approve a production deploy.

The checklist lives in this file so every bot and every future merger reads the same gate. If the checklist and a bot's contract ever disagree, the checklist wins for anything touching `main` or production.
