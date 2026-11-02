# Adrian's Mind Command OS

Private source for Adrian's Mind Command OS. This repository is the implementation home for the owner-controlled command center and its AI agent/tool runtime. It is not Oak Bridge or BridgePoint, and those projects are not used as its database.

## AI team and callable tools

Start with [`AGENTS.md`](AGENTS.md) and the [AI Team Operator Guide](docs/AI_TEAM_OPERATOR_GUIDE.md). The canonical team contract is `team/manifest.json`; requested/upstream integrations are tracked in `tools/registry.json`.

The repository-native tools currently exposed to compatible AI runners are:

- `rea.scan` — offline source inventory.
- `security.scan` — defensive heuristic static review of authorized source.
- `knowledge.search` — offline lexical retrieval from Markdown/text notes.
- `team.health` — repository readiness report.
- `team.queue` — durable SQLite job management.
- `team.worker` — bounded worker using an explicit allowlist.
- `team.agent.resolve` — specialist prompt resolution for host-side model execution.
- `mcp.remote` — HTTPS remote MCP discovery/call bridge with explicit server and tool allowlists (no endpoints enabled by default).
- `model.generate` — explicit Grok/xAI, OpenRouter, or Ollama route with environment-only credentials and paid-route budget preflight.
- `notion.controller` — Notion search/retrieval and explicit text append using `NOTION_API_KEY`.

List the declared tools:

```bash
python team/runner.py --task '{"operation":"list-tools"}'
```

Run team tests:

```bash
python -m unittest discover -s team -p 'test_*.py'
```

MCP transports:
- Stdio: `python team/mcp_server.py`, declared in root `.mcp.json`.
- Authenticated HTTP: `team/mcp_http.py`, containerized by `Dockerfile.mcp`. It requires `MCP_AUTH_TOKEN`; a publishable image does not by itself mean a public service is deployed.

## Readiness is evidence-based

A registry entry is a catalog record, not proof of native AI invocation. Upstream projects with source/bootstrap metadata are not fully integrated until an executable adapter, schema, permissions, configuration, tests, and MCP exposure exist. See the registry's individual status fields and the operator guide.

The command-center provider and Notion API adapters are now repository-callable through the team runner. Set secrets only in the execution environment; no provider or Notion request occurs unless the tool is explicitly invoked. GitHub Codespaces source/package setup is defined in `.devcontainer/devcontainer.json`. The integration status ledger is `tools/integrations/catalog.json`. Project-state tracking, semantic RAG, browser/video, device/voice, and end-to-end approval/audit runtime wiring remain separately gated by actual runtime and verification evidence. See [the operator guide](docs/AI_TEAM_OPERATOR_GUIDE.md) for guardrails and the current scope.

God's Eyes and Arrow EA remain unresolved until their exact projects are identified. BlackEye phishing and credential-harvesting functionality is excluded. Defensive analysis tools are for owned or explicitly authorized targets only.

## Validation

CI checks JSON/config consistency, bootstrap metadata, REA/security/knowledge/team tests, runner and MCP smoke tests, and the hosted MCP container build. See `.github/workflows/rea-tests.yml`.
