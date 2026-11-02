# Tooling Setup Status — GitHub

**Repository:** https://github.com/emzylavish-art/adrians-mind-command-os  
**Status:** Tool inventory and integration scaffolding are committed; the listed external tools are NOT installed or live-connected by this document.

## What exists in this repository
- `docs/TOOLING_CATALOG_AND_INTEGRATION_PLAN.md` — candidate tool catalog, required provenance, security review, integration lifecycle.
- `docs/IMPLEMENTATION_BACKLOG.md` — implementation work and acceptance gates.
- `docs/AGENT_AUTONOMY_AND_APPROVAL_CONTRACT.md` — agent action/approval boundaries.
- `docs/MIND_COMMAND_SOURCE_OF_TRUTH.md` — status/evidence rules.

## Setup truth
GitHub can hold manifests, adapters, workflows, code, and setup instructions. It does not itself install software on the user's PC or provision a runtime. No external MCP endpoint, provider credential, hosted worker, or local installation is confirmed by these docs. Treat every connector as **planned/unverified** until a specific adapter is implemented, configured outside the repository, tested, and its live connection verified.

## Catalog status
The tooling catalog includes candidate references to Everything Claude Code, Superpowers, GSD Core, UI UX Pro Max, n8n-MCP, LightRAG, Claude Mem, Obsidian Skills, Awesome Claude Code, REA, Ghidra, JADX, Frida, Burp Suite, OWASP ZAP, GDB, and x64dbg. These are not asserted to be installed. BlackEye is explicitly restricted from credential-collection operation. God's Eyes and Arrow EA remain unidentified until their exact source and purpose are supplied.

## Required next implementation sequence
1. Resolve and pin upstream sources/versions, licenses, supported platforms, and dependencies.
2. Add machine-readable manifests and integration adapters only for confirmed tools.
3. Configure credentials through approved secrets management; never commit secrets.
4. Add health checks, adapter contract tests, and explicit status/evidence.
5. Verify live connections individually; mark only evidence-backed states.
6. Keep local installation and hosted deployment separate from GitHub documentation and do not claim them without verification.

## Status vocabulary
- **Documented:** reference and intended use recorded.
- **Scaffolded:** integration contract/configuration structure exists.
- **Implemented:** code exists.
- **Tested:** relevant automated tests pass.
- **Live-verified:** real connection or operation succeeded with timestamped evidence.
- **Blocked:** missing source, permission, credential, runtime, or required approval.

