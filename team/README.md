# Mind Command OS — Agent Team

This repository is a **callable tool team**, not a folder of disconnected scripts. Agents discover capabilities through `team/manifest.json`, use a common tool contract, and route requests to the right specialist. Implementations must declare readiness accurately.

## Team map
- **Orchestrator** — classifies task, builds plan, dispatches specialists, combines evidence.
- **Analysis / Research** — repo and document inspection; source-grounded research.
- **Engineering / Codex** — implementation, tests, refactors, CI verification.
- **Reverse Engineering / REA** — static inventory and authorized code analysis.
- **Security Review** — defensive checks on owned/authorized code and systems.
- **God's Eyes** — named capability in catalog; implementation is not yet verified. Do not claim callable until provider/source is mapped.
- **Memory / Knowledge** — project context and retrieval.
- **Browser / Workflow** — browser automation and external workflow adapters; require declared connector and authorization.
- **QA / Release** — test, validate, package; no auto-merge/deploy unless explicitly configured.
- **Observability** — health/status and run logs.
- **Human Approval** — gates consequential external actions.

## Routing
Any compatible agent (Grok, Codex, Claude, or another runner) should:
1. Read `team/manifest.json`.
2. Select by `capabilities`, not agent name alone.
3. Check `status`, `entrypoint`, and `requires`.
4. Invoke only the listed entrypoint and pass the documented JSON input.
5. Return evidence, result, and limitations; never fabricate a successful run.

The manifest is a shared interchange contract. It does not magically provide model credentials or runtime services. Each tool's status is tracked separately.
