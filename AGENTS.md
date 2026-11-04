# Adrian's Mind Command OS — AI Operator Guide

This repository is the implementation source for Adrian's Mind Command OS and its agent/tool runtime. Treat this file as the fast-start contract for Grok Build, Codex, Claude, GitHub Copilot, and compatible AI runners. Read `docs/AI_TEAM_OPERATOR_GUIDE.md` for the full tool map and invocation examples.

## Source of truth and execution discipline

- Repository: `emzylavish-art/adrians-mind-command-os`; default branch: `main`.
- The Notion command center carries architecture decisions, continuity, and current project state. The GitHub repository carries implementation, executable adapters, schemas, tests, and deployment configuration. If Notion says a feature is live, verify the code and deployment evidence before repeating that claim.
- Read the current AI handoff and Master System Achievement & Project State in Notion before making substantial changes when the connected Notion source is available. Do not infer that old branch notes are current.
- Never touch the two explicitly forbidden Supabase projects: `ybxowvzicirinpdcfyqe` and `espmxiitzucooxblmnpr`. Do not create paid infrastructure or change provider settings without explicit owner authorization.
- Never commit API keys, access tokens, private user data, or secrets. Use environment variables / secret managers and redact sensitive values from logs.
- No code changes to production/main or deployment of consequential changes without owner authorization and successful validation. Work in a focused branch/preview where appropriate.
- Do not report a tool, agent, provider, or deployment as active merely because its name appears in a registry, manifest, prompt, or source file. State evidence and limitations.

## Discover and use the team

1. Read `team/manifest.json` for the canonical agent/tool contract and readiness states.
2. Read `tools/registry.json` for upstream tool identity, source, and integration state.
3. Prefer ready tools and invoke through `team/runner.py` or the MCP server. Do not bypass the declared adapter and safety checks.
4. For specialist instructions, call `team.agent.resolve` with an `agent_id`, or with a task plus explicit capabilities. The resolver returns a prompt; the host AI is responsible for actual model execution.
5. For a website, landing page, or app screen, read `team/WEBSITE_TEAM.md` first, then run `python3 tools/website/passes.py plan --surface <name>`. The first look at that surface must use every tool it lists. After the owner is satisfied with one tool on that surface, record it and do not use that tool on that same surface again. Use the tools still listed to find a different gap. Confirm the crew is on disk with `python3 tools/website/kit.py`. Do not use a 21st.dev key copied from a video. Arrow EA, Blackbox, and BlackEye are not part of this pass.
6. Use `team.queue` for durable job records and `team.worker` only for the explicit allowlist. A queue record is not an instruction to execute arbitrary shell, code, or external side effects.
7. Validate the result with evidence, relevant tests, and a clear limitation list.

## Ready repository tools

- `rea.scan`: offline source inventory.
- `security.scan`: defensive heuristic static scan of authorized source; human review required.
- `knowledge.search`: offline lexical retrieval over local Markdown/text.
- `team.health`: repository-declared readiness and entrypoint check.
- `team.queue`: SQLite task enqueue/claim/complete/fail/list.
- `team.worker`: at most one queued task through the worker allowlist.
- `team.agent.resolve`: specialist prompt resolution.
- `model.generate`: explicit Grok/xAI, OpenRouter, or Ollama inference via `team/provider_router.py`; paid routes require budget preflight and secrets are environment-only.
- `notion.controller`: Notion search/retrieve and explicit text append via `tools/notion/controller.py`; `NOTION_API_KEY` is environment-only.

The requested source repositories are pinned as Git submodules under `upstream/` in `.gitmodules`. GitHub Codespaces setup in `.devcontainer/devcontainer.json` initializes those pinned sources and installs the declared npm/Python packages inside the Codespace. Run `bash tools/bootstrap/verify-github-workspace.sh` for presence checks. This does not configure provider credentials or claim external service readiness. The integration activation ledger is `tools/integrations/catalog.json`. The upstream catalog includes projects such as Everything Claude Code, Superpowers, GSD, UI UX Pro Max, n8n-MCP, LightRAG, Claude Mem, Obsidian Skills, Ghidra, JADX, Frida, Burp, ZAP, GDB, and x64dbg. Their catalog entries and source/bootstrap metadata are not equivalent to a native callable adapter in this repository. Consult each record's `status`, `install`, and `live` fields. Do not claim the host AI can invoke a third-party tool until its executable adapter, configuration, permissions, and tests exist.

God's Eyes and Arrow EA remain unresolved until the exact upstream project is identified. BlackEye's phishing and credential-harvesting functionality is excluded. Defensive security tooling is for owned or explicitly authorized targets only.

## Standard validation

Run the checks available in the repository and report actual outcomes:

```bash
python -m json.tool team/manifest.json >/dev/null
python -m json.tool tools/registry.json >/dev/null
python -m json.tool tools/bootstrap/upstream-sources.json >/dev/null
python tools/bootstrap/validate_bootstrap.py
python team/validate_manifest.py
python -m unittest discover -s tools/rea -p 'test_*.py'
python -m unittest discover -s tools/security_review -p 'test_*.py'
python -m unittest discover -s tools/knowledge -p 'test_*.py'
python -m unittest discover -s team -p 'test_*.py'
```

CI is the authoritative repository test gate. A passing unit test does not prove a hosted provider, remote MCP endpoint, live app session, or external account is connected.
