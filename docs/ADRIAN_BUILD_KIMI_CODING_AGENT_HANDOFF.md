# Coding Agent Handoff — Adrian Build / Kimi Code

## Single source of implementation truth

Follow these documents in this order:
1. `docs/ADRIAN_BUILD_KIMI_MASTER_IMPLEMENTATION_BLUEPRINT.md` — complete end-to-end contract, website-first deployment order, all phases and exit gates.
2. `docs/ADRIAN_BUILD_KIMI_BLUEPRINT.md` — original architecture notes; reconcile any older sequencing with the master blueprint.
3. `docs/ADRIAN_BUILD_KIMI_FEATURE_MATRIX.md` — evidence-based capability status.
4. This handoff — execution discipline and reporting requirements.

**Critical owner decision:** deliver the hosted website experience first. The first release must not require the owner's Windows PC. A persistent hosted Kimi runtime is required; Vercel serverless functions must not host the long-lived Kimi process. Windows Companion/local PC execution is a later phase.

## Assignment

Implement the full Kimi Code coding environment inside the existing Adrian OS Build destination. Use the real pinned Kimi Code runtime and supported APIs. Do not create a clone, fake agent, chat-only wrapper, iframe-only integration, external-link-only experience, second application or separate sign-in.

Work on `feature/adrian-build-kimi-integration`. Do not commit to `main`, merge, change production secrets, run production migrations, provision paid infrastructure or deploy production without the applicable owner approval and successful gates.

## Mandatory Phase 0

1. Read root `AGENTS.md`, `ENGINEERING.md`, README, the latest Notion AI handoff and Master System Achievement & Project State.
2. Fetch current `main`, this branch and PR #52. Record exact SHAs and reconcile ancestry; do not assume historical SHAs are current.
3. Inspect Build sidebar/route wiring in `src/components/mind/command-app.tsx`, navigation registries and route tests.
4. Inspect existing auth, workspace/project, persistence, provider vault/router, MCP, PC pairing, approvals, audit, emergency stop, event streaming, voice/Adrian Speak and deployment topology. Reuse existing abstractions.
5. Audit `tools/integrations/catalog.json`, `tools/registry.json`, `.gitmodules` and existing adapters. Distinguish catalog-only/source-pinned/configured/live-verified.
6. Inspect official Kimi Code upstream source and current docs. Record exact release/tag, commit SHA, supported platforms, runtime requirements, package provenance, exact license and notices, configuration format, provider support, plugins, skills, agents/subagents, hooks, MCP and server API.
7. For the exact pinned runtime, retrieve and preserve its served `/openapi.json` and `/asyncapi.json`; use these schemas as the API contract. Upstream documents the REST/WebSocket API as experimental, so add schema/version compatibility tests.
8. Identify the persistent hosted runtime service and network/security design for the website release. Do not require PC access for Phase 1. Do not assume an unapproved vendor or paid service is provisioned.
9. Produce a Phase 0 audit with file-level plan, ADRs, baseline tests, feature matrix, risk list and owner-only decisions before broad edits.

## Implementation order

Follow the master blueprint's Phase 0–9 and its exit gates exactly:
- Phase 1: hosted persistent Kimi runtime, gateway, adapter, real session and event proof.
- Phase 2: Adrian-native Build shell and core vertical slice.
- Phase 3: files/editor/diffs, terminal, Git and project lifecycle.
- Phase 4: skills, subagents, plugins, MCP and hooks.
- Phase 5: provider/credential bridge, usage/quota, attachments and Adrian Speak.
- Phase 6: security, resilience, observability and production readiness.
- Phase 7: preview acceptance and owner-approved website production deployment.
- Phase 8: Windows Companion and local runtime.
- Phase 9: operations, upgrades, monitoring and rollback.

Do not skip phases by marking controls complete before their real implementation and tests exist.

## Security and repository rules

- Preserve existing Adrian OS architecture, navigation and user data.
- Use server-side Adrian identity; never trust client-supplied owner IDs.
- Kimi tokens and provider/MCP secrets stay server-side/in secret storage; never enter browser bundles, source control, logs, screenshots or transcripts.
- Runtime is isolated, non-root, resource-limited and network-restricted; use approved workspace roots only.
- All writes, terminal commands, Git side effects, plugin installs, MCP actions and external operations must pass Adrian policy/approval.
- Fail closed on unknown runtime version, unsupported API, missing permission, policy timeout or lost runtime identity.
- Never access forbidden Supabase projects `ybxowvzicirinpdcfyqe` or `espmxiitzucooxblmnpr`.
- No production secrets changes, production migrations, paid infrastructure provisioning, merge or production deploy without owner authorization.
- Do not claim a capability is live from UI, manifest, registry, mocks or a health endpoint.
- Preserve exact upstream license and copyright notices after verifying the pinned revision; do not assume the license is MIT.
- Use focused commits, add tests with each adapter/security/data change and avoid multiple agents editing the same files simultaneously.
- Run the repository standard validation in `AGENTS.md` and report exact commands/results.

## Required first hosted vertical slice

Before broad UI work, prove the hosted website path with the real pinned runtime:
1. Authenticated Adrian Build request reaches the Adrian gateway.
2. Gateway allocates an isolated hosted runtime/workspace lease.
3. Create a real Kimi session in the authorized workspace.
4. Submit a prompt and stream real response/tool events to Adrian UI/test harness.
5. Edit a disposable file and return a reviewable diff.
6. Run a harmless allowlisted command and stream actual output/exit code.
7. Stop/cancel and verify child process termination.
8. Reconnect/replay from a cursor without duplicate task execution.
9. Restart runtime and recover or mark task interrupted deterministically.
10. Prove a second user cannot access the first user's runtime, files, session or events.

This must run without the owner's Windows PC. A developer's local Kimi process is useful for development, but does not satisfy the hosted Phase 1 gate.

## Required final report

- Branch, PR, commits and changed files.
- Exact Kimi release, commit, license and runtime image digest.
- OpenAPI/AsyncAPI schema digests and adapter protocol.
- Runtime hosting target and evidence (dev/preview/production distinguished).
- Feature matrix: VERIFIED / PARTIAL / UNSUPPORTED / BLOCKED / NOT_AUDITED.
- Exact test commands, environment, pass/fail/skip counts and evidence links.
- Tenant isolation, policy, approval, audit, secret-redaction and sandbox evidence.
- Provider/MCP/plugin/skill/subagent/hook tests actually executed.
- Adrian Speak browser/hardware verification state.
- Preview and production SHA/image evidence only if actually deployed.
- Windows Companion status (must remain a later phase until hosted website release is complete).
- Remaining owner-only decisions and blockers; no implied completion.
