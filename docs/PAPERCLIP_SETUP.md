# Paperclip integration — Adrian's Mind OS

## Current status

Paperclip is not yet installed on a persistent host. The manual GitHub
workflow "Paperclip installation preflight" verifies a version-pinned CLI on a
*temporary* GitHub Actions runner. The runner disappears when the job ends:
this is not a continuously operational agent system.

The existing Vercel project "adrians-mind" stays the one user-facing production
site. Paperclip requires its own persistent server and isolated database.

## Requirements for running Paperclip

- Persistent Linux/macOS/WSL2 host or supported container host with sufficient
  disk, RAM and backup policy. The host must be explicitly approved before
  provisioning paid infrastructure.
- Node.js 24.11 or later on the actual service process.
- Version-pinned, reviewed Paperclip installation.
- Authenticated access for any remote instance. Never expose local-trusted mode
  to the public internet.
- Separate durable Paperclip database/volume, not the Adrian's Mind schema.
- One approved agent runtime with usable credentials and strict cost limits.
- Least-privilege GitHub read permissions for the initial Codebase Auditor.
- No production deployment authority granted to agents by default.

Read https://github.com/paperclipai/paperclip/blob/master/doc/INSTALLING.md

### Pinned local trial (on a supported host)

    npx --registry https://registry.npmjs.org paperclipai@2026.1106.0 onboard --yes --no-install-service
    npx --registry https://registry.npmjs.org paperclipai@2026.1106.0 doctor

For a permanent host, use the official managed installer after pinning and
reviewing the source/release. Configure a supervised background process,
encrypted secrets, persistent storage, TLS, private access, and backups.
Do not run Paperclip as an unbounded serverless Vercel function.

## First agent: read-only Codebase Auditor

1. Set up one company/team in authenticated Paperclip.
2. Configure one actual runtime (Codex/Claude/OpenCode/etc.) and hard monthly
   spending limits. No unfunded inference is assumed.
3. Grant read-only access to emzylavish-art/adrians-mind-command-os.
4. Instruct the agent to inspect out/interface-audit.json (CI artifact),
   route handlers, authentication, state persistence, migrations and tests.
5. Give an explicit "no Git writes / no paid deployments" permission boundary.
6. Require its signed/execution-linked report, complete with source paths,
   testable acceptance conditions and identified risks.
7. Verify task execution and results before hiring further coding agents.

## Proposed future connection to Adrian's Mind

- Paperclip manages agents, jobs, approvals, budgets and actual task outcomes.
- Adrian's Mind owns the user-facing UI, AI provider registry, voice and graph.
- An authenticated, owner-scoped server-side adapter reads Paperclip's *verified
  installed-version API* and publishes actual job status to the 3D graph.
- No Paperclip credential is served to browsers or stored in Git.
- Tool broker integrates approved MCP servers and custom provider APIs.
- The app's current scripts/mind-worker.mjs deliberately exits. Do not remove
  the forbidden-database safeguards while implementing a real worker.
- All changes flow through one Git lineage, independent checks and one
  approved Vercel production deployment. Do not cancel slow builds.

## Verification and blockages

- No persistent Paperclip host is currently connected or confirmed.
- The available local execution container has Node 22.16 and no outbound
  public npm/GitHub DNS connectivity; it is unsuitable for installation.
- A funded/working runtime is necessary for real AI task execution.
- Run "Paperclip installation preflight" manually in GitHub Actions to verify
  the pinned package can be installed in a temporary Node 24 environment.
- Run "Adrian's Mind production verification" to obtain an action inventory
  artifact named mind-interface-inventory.
- The inventory is static: a button with onClick is not "working" until a real
  authenticated browser/backend operation passes.
- Do not assume production OAuth migrations have applied solely because
  they exist in main; check the deploy-time migration logs and database.

## Acceptance criteria

Paperclip is genuinely installed only when a persistent host's service reports
healthy, one real read-only agent executes a bounded task with a usable model,
the result is durably recorded, and the Adrian's Mind adapter can fetch an
authenticated result without granting any agent independent production access.
