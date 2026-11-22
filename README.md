# Adrian's Mind Command OS

Source for Adrian's Mind Command OS. This repository is the implementation home for the owner-controlled command center and its AI agent/tool runtime. It is not Oak Bridge or BridgePoint, and those projects are not used as its database.

## Windows installer

There is one product: `AdriansMind-Setup-Full.exe`. The old thin installer is retired. GitHub cannot host one 6 GB file, so the release is four parts. Download all four, join them, then check the hash before you install.

Release: https://github.com/emzylavish-art/adrians-mind-command-os/releases/tag/desktop-installer

Site download: https://adrians-mind.vercel.app/downloads/AdriansMind-Setup.exe

Download these files from that release:

- `AdriansMind-Setup-Full.exe.part00`
- `AdriansMind-Setup-Full.exe.part01`
- `AdriansMind-Setup-Full.exe.part02`
- `AdriansMind-Setup-Full.exe.part03`

Put them in the same folder. On Windows, join them in that order:

```bat
cmd /c copy /b AdriansMind-Setup-Full.exe.part00+AdriansMind-Setup-Full.exe.part01+AdriansMind-Setup-Full.exe.part02+AdriansMind-Setup-Full.exe.part03 AdriansMind-Setup-Full.exe
```

The joined file must be 6,389,066,607 bytes. Its SHA-256 must start with `e88ff220` and match the full hash exactly:

```text
e88ff2205540742bd5d9ee75be09e9938e522a00ce0f0514af6c5da14a2d0550
```

Check it in PowerShell:

```powershell
Get-FileHash .\AdriansMind-Setup-Full.exe -Algorithm SHA256
```

If the hash does not match, do not install. Download the parts again. Do not mix this file with any older thin `AdriansMind-Setup.exe`.

Part hashes:

| Part | Bytes | SHA-256 |
| --- | ---: | --- |
| part00 | 1992294400 | 6981d9d2f71aeaf0ee8513ae41cb597a9aa0b38db16bad4d04746ef6783d4391 |
| part01 | 1992294400 | 4a5707ea3ff877079905308895a826b0dcaa5cce30353296e7c36972405c23d0 |
| part02 | 1992294400 | 68737294d7b9f4db44717196f1841b2c91f1dae918c1725dda75a2740958d7ac |
| part03 | 412183407 | ba4642adb7618c8ff25979584093849c3477facaf0508e6e39f8b20ffb2f0870 |

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
