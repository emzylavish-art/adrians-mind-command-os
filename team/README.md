# Mind Command OS — Agent Team

The team manifest is the interoperability contract. The shared Python runner provides
a concrete JSON entrypoint for compatible hosts (Grok, Codex, Claude, or another
runner); it does not perform model inference or claim external services are live.

## Entry points

- `python team/runner.py` — JSON task through stdin.
- `python team/runner.py --task '{"operation":"list-tools"}'` — inspect tool catalog.
- `python team/runner.py --task '{"operation":"route","task":"inspect source","capabilities":["source_inventory"]}'` — create a specialist dispatch.
- `python team/runner.py --task '{"operation":"invoke","tool_id":"rea.scan","input":{"path":"."}}'` — execute the implemented REA scanner.

### JSON contract

Input requires an `operation`:
- `route`: requires `task`; optional `capabilities` and `context`.
- `list-tools`: returns declared catalog entries and their status.
- `invoke`: requires `tool_id`; optional `input` object.

Responses use `status`, `result`, `evidence`, `limitations`, and `dispatch`.
A declared catalog entry is not proof of an installed executable, configured provider,
credentials, or live runtime. Unsupported tools return a non-ready status rather than
being simulated. External actions and deployment remain gated by explicit authorization.

## Team map

- **Orchestrator** — task classification, planning, dispatch, synthesis.
- **Analysis / Research** — reasoning, requirements, evidence-based research; provider adapter required.
- **Engineering / Codex** — coding, refactoring, tests, CI.
- **REA** — offline source inventory and static reconnaissance.
- **Security** — defensive checks on owned or authorized systems.
- **God's Eyes / Arrow EA** — identity/source not verified; no fabricated implementation.
- **Knowledge** — retrieval/organization; knowledge-store adapter required.
- **Browser / Workflow** — browser tasks; authorized runtime and connector required.
- **QA / Release** — tests and validation; no automatic merge/deploy by default.
- **Observability** — status and logs.
- **Human Approval** — authorization gate for consequential external actions.

## Tests

`python -m unittest discover -s team -p 'test_*.py'`

The manifest remains the authority for capability matching, readiness, and requirements.


## MCP stdio server

A minimal JSON-RPC stdio server exposes tools marked `ready` in the manifest to MCP-compatible hosts:

```bash
python team/mcp_server.py
```

Configure an MCP client to launch that command from the repository root. The current
server publishes `rea.scan` only because it is the only fully implemented and ready
tool adapter. The server implements `initialize`, `tools/list`, and `tools/call`;
it does not launch model agents or invent adapters for unresolved tools.
