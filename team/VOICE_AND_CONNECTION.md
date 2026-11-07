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

═══════════════════════════════════════
SECURITY ENFORCEMENT STRUCTURE
AUTO-EXECUTED BY EVERY AI WORKING ON THIS REPO
NO HUMAN APPROVAL REQUIRED TO FOLLOW THESE RULES
VIOLATION IS A P0 THE ENFORCER FLAGS IMMEDIATELY
═══════════════════════════════════════

## 1. SECRET HANDLING (NON-NEGOTIABLE)

- Real credential values never appear in any committed file. Not in code, not in docs, not in handoff notes, not in commit messages, not in PR bodies, not in comments.
- Only variable names are allowed in the repo. Values live exclusively in Vercel project env settings, in /home/box/.secrets/ on the host, or in a secrets manager.
- .env.example is the only env file that may be committed, and it must contain blank values only.
- .gitignore must always contain: .env, .env.*, .pem, .sqlite3, .data/, attachments/, artifacts/. If any AI modifies .gitignore and removes these lines, that is a P0.
- Connection records in the database must never store a secret field. readFleet forces secretStored false. Any code path that writes a secret into a DB row is a P0.
- Logs, reports, handoff files, and error traces must redact tokens before writing. If a stack trace or error message contains a key-looking string, it is stripped before persistence.
- OAuth client secrets, service-role keys, management keys, and pairing secrets follow the same rule. Names in repo, values outside repo.
- Forks and clones given to other people receive code only. No env values, no connection credentials, no API keys travel with the code. The recipient fills their own values in their own Vercel project.

## 2. WHAT EVERY AI MUST DO BEFORE COMMITTING

Before any push or commit, the AI runs this checklist against its own diff:

1. Scan the diff for patterns: sk-, eyJ, xai-, sb_, Bearer, password=, secret=, token=, api_key, api-key, PEM headers, long base64 blobs.
2. If any match appears, the AI stops, redacts or removes it, and does not commit until clean.
3. If a secret was already committed in a prior turn, the AI treats it as a P0: it does not just delete the line — it rotates the exposed credential through the provider dashboard and documents the rotation in the handoff.
4. The AI writes one line to the commit or PR body stating: secret scan performed, zero matches, or the exact match found and removed.

## 3. WHAT THE ENFORCER CHECKS

- Every bot run must show evidence of the pre-commit scan. No scan evidence means the run is rejected.
- Any file in git containing a real-looking credential is a P0, regardless of which bot wrote it.
- Any .gitignore modification that removes a protected line is a P0.
- Any code path that persists a secret into the database or a log is a P0.
- The Enforcer does not fix these. It flags them, writes the evidence, and halts the offending bot's lane until a human or Astra resolves it.

## 4. REDACTION STANDARD

When a secret-looking string appears in any output the bot produces — error, log, report, handoff — the bot replaces it with [REDACTED] before writing. The original value is never echoed back to Adrian, never stored in git, and never passed to another bot.

END OF SECURITY ENFORCEMENT STRUCTURE
