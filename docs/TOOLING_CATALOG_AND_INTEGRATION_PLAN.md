# Tooling Catalog and Integration Plan

This is a **candidate catalog and integration plan**, not a statement that every named project has been installed, connected, or verified. Resolve exact upstream repository/package and version before installation. Maintain license, security review, compatibility, and a smoke test for each entry.

## Agent engineering and workflow tools

| Candidate | Intended role | Integration requirement |
|---|---|---|
| Everything Claude Code | Reusable agent workflows, commands, skills, engineering patterns | Inspect upstream contents, license, dependencies, compatibility; adapt selected components instead of blind copying. |
| Superpowers | Structured software-development skills/workflows | Identify exact source/version; install selected reviewed skills; test examples. |
| GSD Core | Project planning/context and execution workflow | Resolve exact project identity; map it to task/state model. |
| UI UX Pro Max | UI design guidance and design-system support | Validate upstream package/source and license; integrate as optional skill/reference. |
| n8n-MCP | n8n workflow discovery/operation via MCP | Configure endpoint/credentials out of band; validate MCP handshake and allowed operations. |
| LightRAG | Retrieval-augmented knowledge layer | Define storage, embedding/model config, provenance, privacy, and retrieval tests. |
| Claude Mem | Persistent coding-agent context/memory | Resolve exact project/scope; assess retention/privacy; avoid secrets and full conversations by default. |
| Obsidian Skills | Knowledge-workflow skills | Identify exact skills/dependencies; integrate relevant items only. |
| Awesome Claude Code | Discovery index of tools and skills | Directory, not executable dependency; select and verify entries individually. |
| REA — Reverse Engineer Anything | Repository/system inventory and reverse-engineering workflow | Authorized targets only; record source/evidence and distinguish inference from fact. |

## Defensive security and reverse-engineering tools

| Candidate | Intended role | Boundary |
|---|---|---|
| Ghidra | Authorized binary analysis | Owned/authorized binaries; isolate samples and document scope. |
| JADX | Android APK analysis | Authorized app analysis; protect extracted secrets and user data. |
| Frida | Runtime instrumentation/testing | Owned or explicitly authorized apps/devices; no unauthorized bypass or extraction. |
| Burp Suite | Web application security testing | Authorized test environments; define scope and avoid real-user data. |
| OWASP ZAP | Web application security testing | Authorized targets; passive scan by default; active scans require explicit scope. |
| GDB | Debugging | Local/authorized targets. |
| x64dbg | Windows debugging | Local/authorized targets. |
| BlackEye | Exact upstream identity needs confirmation; name is associated with phishing-style tooling | Do not install or operationalize credential collection. Keep any inventory entry restricted and use safe awareness/testing alternatives. |

## Names requiring identification from source material

- **God's Eyes** — exact project, upstream URL, and intended function not verified.
- **Arrow EA** — exact project, upstream URL, and intended function not verified.

Do not guess. Capture source URL or recording timestamp when resolved.

## Required manifest for each approved integration

Canonical name; upstream URL; pinned version/commit; package/install method; license; supported OS/runtime; dependencies; environment variable names (never values); permission scopes; data handled; security review; adapter path; MCP/tool schema; health check; smoke test; known limitations; status (planned, partial, implemented, tested, live-verified, blocked); last verification date; rollback/uninstall procedure.

## Installation lifecycle

1. Discover exact upstream identity.
2. Review license, supply-chain risk, permissions, compatibility.
3. Pin version and record provenance.
4. Install in an isolated environment.
5. Configure secrets outside GitHub.
6. Run deterministic smoke and contract tests.
7. Verify real connection only when explicitly configured.
8. Enable in tool registry with least privilege.
9. Log updates and provide rollback.
