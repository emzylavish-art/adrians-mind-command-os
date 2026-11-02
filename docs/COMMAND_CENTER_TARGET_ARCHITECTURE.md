# Adrian's Mind Command OS — Target Architecture and Implementation Ledger

**Purpose:** Preserve the agreed system blueprint inside GitHub so every repository-aware AI can see the intended product, distinguish implementation from plans, and continue without reconstructing decisions from chat.

**Authority model:** Notion is the continuity and decision bus; this repository is the code, adapter, schema, test, and CI source. The current AI Handoff and Master System Achievement & Project State in Notion remain the latest operational truth. This document is the GitHub-side architecture map, not proof that every target capability is connected.

## Product definition

Adrian's Mind is an owner-controlled AI command center / personal operating system, not a generic chatbot. Target surfaces are the web application, Tauri desktop app, and later iPhone/mobile, sharing one codebase where practical. The command center should expose task state, agent routing, provider choices, memory, integrations, costs/limits, approvals, and observable execution.

## System roles and flow

- **Human owner:** final authority; sets goals, permissions, provider and budget choices, approvals, and emergency stop.
- **Grok / xAI:** intended orchestration and judgment route; should plan, select specialists, review evidence, preserve continuity, and report failures. It is not assumed live without server configuration and a successful verified call.
- **GPT / Codex:** structuring and engineering role; turns raw material into specifications, schemas, code changes, tests, and focused implementation work.
- **Manus:** research lane for external research and structured findings, routed through the shared continuity system when used.
- **Specialist agents / workers:** fixed scopes such as observer, spec writer, logger, Notion hygiene, engineering, QA, security, research, and worker runtime.
- **Notion:** shared command center, authoritative decisions/continuity, task ownership, and project-state record. Agents should communicate through Notion records rather than peer-to-peer side channels.
- **GitHub:** source of code, manifests, tool adapters, tests, prompts, workflows, and deployment definitions.
- **Operational database / memory:** owner-scoped persistence and project memory must be clearly distinguished from browser-local or ephemeral storage. Do not claim cloud persistence unless configured and verified.
- **Google Drive:** intended scheduled backup lane; not considered connected until implemented and verified.

Canonical task lifecycle:

1. Read the current command-center state and the assigned task.
2. Claim/record ownership and a task identifier before work.
3. Route to a specialist using explicit capabilities and permission policy.
4. Execute only declared, allowlisted operations.
5. Capture results, logs, evidence, failures, and limits.
6. Validate output and require owner approval for protected actions.
7. Write the one-line operational record and update durable project state.
8. Stop on ambiguity, repeated failure, budget limit, kill switch, or missing permission.

Notion log format required by the fleet blueprint:

`YYYY-MM-DD HH:MM | BOT-NAME | ACTION | RESULT | NEXT`

## Provider and model routing

Target routes:

- Grok / xAI API.
- OpenRouter for model choice and provider diversity.
- Local Ollama models, including a local conductor / routing role and model-specific handling such as gpt-oss-20b.
- Owner override of routing and effort.
- Capability, latency, and cost-aware route selection.
- Budget/cost accounting with warning at 80%; at 100%, route locally or pause according to owner policy.
- Evaluation scoring on a 1–5 scale where configured.
- Direct mode preserves provider input/output and refusals verbatim; orchestrated mode may decompose, validate, and synthesize within the agreed policy.

**Verification requirement:** a provider/model in a dropdown, config file, or prompt is not connected. The adapter, credentials (never committed), successful permitted call, usage/cost telemetry, failure behavior, and applicable tests must exist before marking it live.

## Orchestration, governance, and audit

The orchestrator must provide:

- Classification, decomposition, dependency ordering, specialist selection, and delegation.
- Permission checks before every tool action.
- Memory/context retrieval and project-state continuity.
- Task ownership, status, cancellation, retry/failure policy, and execution tracking.
- Evidence-based synthesis and explicit uncertainty.
- Human approval gates for merges, production changes, external sends/publishing, destructive operations, credentials/permissions, and other consequential side effects.
- Emergency stop / kill switch and enforcement that survives process restarts where designed.
- Immutable or append-only execution records for consequential actions.
- Collision handling for concurrent agents, branch conflicts, duplicated work, and task claims.
- A controlled red-team/security test environment for the orchestrator, workers, MCP interfaces, Notion boundary, and device-control adapters.

A prompt-only “be careful” rule is not technical enforcement. Protected actions must be blocked by code without a valid authorization record.

## Integration and capability map

| Capability | Target behavior | GitHub status at this snapshot |
|---|---|---|
| Agent/team manifest and capability router | Specialist roles, explicit capability matching, requirements, status and prompt resolution | Implemented in repository; verify via tests |
| REA source inventory | Offline source tree inventory | Implemented; callable CLI/runner/MCP |
| Defensive static security review | Heuristic scan of authorized source | Implemented; callable; findings require human review |
| Knowledge retrieval | Search project knowledge | Implemented as offline lexical retrieval; semantic RAG is not connected |
| Durable queue / worker | Store jobs, claim leases, run bounded allowlisted tasks | Implemented in repository; worker is not arbitrary code execution |
| MCP stdio | Expose ready repository tools to a compatible host | Implemented; root `.mcp.json` is a client registration example |
| Hosted MCP | Authenticated JSON HTTP transport and container | Code/build workflow exists; no public service is asserted without hosting evidence |
| Grok/xAI provider | Live inference from command center | Not verified in current operational handoff; server-side key/configuration is a blocker |
| OpenRouter | Model gateway and provider selection | Target; no verified live adapter in current ready-tool inventory |
| Ollama/local conductor | Local model routing and bounded conductor | Target; do not infer connection from docs |
| Notion live controller integration | Read/write task and continuity records from runtime | Target; operational handoff records prior credential/allowlist/writeback blockers |
| Browser observer / Grok Build loop | Repeatedly inspect the deployed app, collect evidence, route issues to scoped agents | Target workflow; observer must remain read/report-only and requires a verified browser runtime |
| Local PC agent / HP pairing | Authorized local execution, device status and approval boundaries | Target; no verified pairing is implied by the repository team |
| Voice / wake word / realtime speech | Actual provider session, input and output audio | Target; browser speech or UI chrome is not realtime voice |
| Screen sharing / camera | Explicitly permissioned visual context | Target; not ready without a real authorized adapter |
| Semantic RAG / LightRAG | Embedding/model-backed retrieval | Upstream catalog entry only until provider, storage, and adapter are wired |
| n8n-MCP / workflow execution | Expose approved automation workflows | Upstream catalog entry only until endpoint/auth/schema/permissions are configured |
| UI UX Pro Max, Superpowers, GSD, ECC, Claude Mem, Obsidian Skills | AI coding/workflow skill integrations | Catalog/source/bootstrap metadata exists; not equivalent to ready repo-native tools |
| Ghidra, JADX, Frida, Burp, ZAP, GDB, x64dbg | Authorized reverse engineering and defensive analysis | Upstream catalog/source metadata; not all are callable MCP adapters in this repository |
| God's Eyes | Requested specialist/tool | Identity and exact source unresolved; do not fabricate |
| Arrow EA | Requested specialist/tool | Identity and exact source unresolved; do not fabricate |
| BlackEye | Requested tool | Phishing/credential collection functionality excluded |
| Google Drive scheduled backup | Backup and recovery | Target; not connected until a verified scheduled backup implementation exists |
| Telegram worker fleet | Fixed-role long-polling bots, task claims, status and Notion logging | Target blueprint; do not report as running without runtime, tokens, logs, and health evidence |
| Cost/budget dashboard | Model usage, spend, thresholds and route controls | Target; current values must come from real provider telemetry |

## Required completion standard for any integration

An integration is **complete and AI-usable** only when all of these are in the repository and checked:

1. Exact upstream identity, source URL, license, and version/provenance.
2. A real adapter or vendored supported implementation—not only a prompt or catalog row.
3. Typed/validated input and output schemas.
4. Least-privilege permissions and safety boundaries.
5. Secret/configuration handling without committed credentials.
6. Registration in the manifest/registry and exposure through the intended runner/MCP client.
7. Automated tests plus a smoke test that exercises the adapter.
8. Evidence of successful invocation and clear failure behavior.
9. Documentation of any host/provider requirement that remains external.

Status vocabulary must distinguish: implemented in repository, callable in a compatible host, configured, live-tested, deployed, and production-verified. These are separate milestones.

## Current operational constraints to preserve

- Never touch Supabase projects `ybxowvzicirinpdcfyqe` or `espmxiitzucooxblmnpr`.
- Do not create paid infrastructure or add credits without explicit approval.
- Never commit API keys, tokens, approval secrets, or private data.
- No production/main code change or deployment without explicit owner approval and required typecheck/build checks.
- Prefer free/local/documentation work when provider credits or credentials are unavailable.
- Owner is the final authority; ambiguity means stop and record the question.
- Do not blindly merge old branches. Inspect each branch's changes and integrate only with tests and conflict review.

## Notion source pages used to preserve the blueprint

- [Adrian's Mind Command OS — AI Handoff](https://app.notion.com/p/40b1aa27632381768d58cde0731f142a)
- [Master System Achievement & Project State](https://app.notion.com/p/3d41aa27632381bfb623d016e68815ba)
- [AI Branch Log — Grok](https://app.notion.com/p/3f71aa27632381949980f39b66dcf5b8)
- [Grok Build Handoff — Living System Current State & Continuation](https://app.notion.com/p/4011aa27632381eb89cedeb7cd37e28f)
- [Shared AI Control Bot — Detailed Implementation Specification](https://app.notion.com/p/3f71aa276323811583ece77e3009bca1)
- [Fleet Connection-to-Execution Blueprint — 2026-11-02](https://app.notion.com/p/40c1aa276323811e941ae76416bed7b0)
- [Definitive Fleet Blueprint — 2026-11-02](https://app.notion.com/p/40c1aa2763238157a3b2e573ca55740d)
