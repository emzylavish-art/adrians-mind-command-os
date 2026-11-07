# Agent Autonomy and Approval Contract

## Operating model

The system may plan, research, read permitted sources, inspect configured services, draft changes, run tests, and delegate bounded subtasks within configured permissions. Each task needs an objective, permitted tools, data scope, budget, deadline, and completion criteria.

A specialist receives only necessary context and returns a structured result with evidence, uncertainty, and blockers. The coordinator validates results before acting.

## Permission tiers

- **Tier 0 — Offline:** planning, analysis, documentation, and code generation without external side effects.
- **Tier 1 — Read-only:** explicitly connected and scoped repositories, websites, and data sources.
- **Tier 2 — Reversible local changes:** files, branches, tests, or local configuration in an approved workspace.
- **Tier 3 — External write:** messages, external records, publishing, or account/service changes. Requires explicit policy approval; default is approval required.
- **Tier 4 — High impact:** payments, credential/security changes, destructive data operations, production deployment, or permission changes. Require direct user approval and logged confirmation; default is deny.

Agents cannot grant themselves permissions or elevate specialist permissions. Tool allowlists and authorization must be enforced by runtime code.

## Monitoring and recovery

- Check only targets explicitly configured by the owner.
- Report exact observation, timestamp, target, and evidence.
- Timeout or login challenge is a failure state; do not claim health.
- Recovery actions must be bounded, reversible, and authorized.
- If recovery is unsafe or cannot be verified, stop and notify.
- Never evade authentication, MFA, access controls, or bot protections.

## Truthful reporting

An API response, test mock, or UI state is not proof of end-to-end success. Distinguish configuration, readiness, test status, and live status. Attach evidence or state what remains unknown.

## Emergency controls

Provide global stop, per-task cancellation, disable-agent control, and credential revocation. Stop controls must be available independently of the agent being stopped.
