# Adrian's Mind Command OS — Source of Truth

**Purpose:** Keep the repository honest and make the intended system implementable by Grok Build, Codex, Claude Code, or a human engineer.

A design document, UI control, stub, environment variable, or test mock is not proof that an integration is live.

## System goal

Build one central operating system for personal AI work. It should coordinate a primary agent and bounded specialist agents, use a common tool/skill catalog, connect only explicitly configured services, maintain durable task state, and report evidence-backed status.

GitHub is the engineering source of truth for code, contracts, setup, tests, and release history. Notion remains the user's project/operational knowledge workspace where applicable. Neither repository contents nor plans imply an external service, local PC, or hosted worker is connected.

## Desired capabilities

1. Coordinator: classify requests, plan steps, choose tools, assign specialist tasks, and reconcile results.
2. Specialists/subagents: narrow roles, independent task records, bounded depth/concurrency, explicit permissions, and structured outputs.
3. Tool and skill registry: discover tools, validate schemas, record source/version/license/configuration, install or enable compatible tools, and test each connection.
4. Durable execution: persistent jobs, queue/lease semantics, retries with backoff, idempotency, cancellation, timeouts, and recovery after restart.
5. Website/service monitoring: scheduled health checks for configured targets, observable authentication failures, incident records, and safe recovery attempts.
6. Browser workspace: controlled browser sessions separating read-only observation from consequential actions.
7. Memory and knowledge: searchable, source-linked project facts; update/conflict handling; no indiscriminate logging of every conversation.
8. Human approvals: approval gates for external, destructive, financial, privacy-sensitive, or account-changing operations.
9. Observability: structured logs, trace/task IDs, agent/tool timing, error categories, evidence artifacts, health dashboard, and truthful status.
10. Evaluation and improvement: reproducible tests, regression suites, issue creation from confirmed failures, and proposed—not silently self-authorized—code changes.

## Truth labels

- **Implemented:** code exists and is connected to its real dependency.
- **Tested:** named test ran and passed; include command/date/evidence.
- **Live-verified:** exercised against the real configured service; record scope and timestamp.
- **Partial:** some path works, but limitations are listed.
- **Stub/mock:** placeholder, simulation, mock, or non-operational adapter.
- **Planned:** requirement only; no working implementation is claimed.
- **Blocked:** requires credentials, pairing, configuration, provider access, or user action.
- **Unknown:** not checked; never infer success.

## Safety and change boundaries

- Never commit API keys, passwords, OAuth tokens, pairing codes, session cookies, private customer data, or machine-specific secrets. Use environment variables and ignored local files.
- Do not bypass access controls, MFA, bot checks, or authentication. A login challenge is a blocked state, not permission to evade it.
- Do not use credential theft, phishing, stealth, persistence, or unauthorized access tooling. Security tools are for authorized defensive testing only.
- Require user approval for consequential actions and preserve an audit trail.
- Never auto-delete data, rotate credentials, publish, spend money, merge, or deploy without the configured authorization policy.
- Do not touch explicitly excluded projects or protected resources. Respect repository and project-specific guardrails.

## Baseline status

The repository already contains Windows agent scripts and architecture/deployment documentation. Existing docs describe a limited delegation runtime and say a durable hosted worker is not provisioned. Treat real provider calls, complete multi-agent orchestration, continuous monitoring, and successful local installation as **unverified** unless new evidence is added.

Update this section only after checking code, running tests, and recording evidence. See [Implementation Backlog](IMPLEMENTATION_BACKLOG.md) and [Tool Catalog and Integration Plan](TOOLING_CATALOG_AND_INTEGRATION_PLAN.md).
