# Adrian OS Kimi — locked execution plan

Authoritative spec: `docs/ADRIAN_OS_KIMI_MASTER_BLUEPRINT.txt`.

This plan overrides the earlier Windows-first sequence. The website must work without the user’s Windows PC. The Windows Companion is Phase 9 and must not block the hosted release.

## Non-contradiction rules

1. Adrian OS remains the control plane. Kimi is the execution engine.
2. The browser never receives runtime tokens, provider keys, or a direct runtime address.
3. Vercel hosts the existing website and short requests only. A persistent Kimi process does not run inside a Vercel serverless function.
4. A control is not shown as working unless its backend operation exists.
5. Status values are only `VERIFIED`, `PARTIAL`, `BLOCKED`, `UNSUPPORTED`, `NOT_CONFIGURED`, `NOT_AUDITED`, `FAILED`, or `DISCONNECTED`.
6. Local fake-ACP smoke tests are not `VERIFIED` Kimi execution.
7. Existing authentication, MCP registry, provider vault, approvals, emergency stop, and sidebar are reused. They are not rebuilt.
8. Parallel agents may write only the files assigned to them. Shared files are integrated by the lead after those files land.
9. Production deployment happens only after the hosted runtime acceptance scenario passes, and only through the existing Adrian OS project. No second website is created.
10. Paid hosting, production secrets, production migrations, and the production deploy itself still require the existing owner approval already given for the end state, but they are not started before the runtime is real.

## What already exists and will be reused

| Area | Evidence | Status |
| --- | --- | --- |
| Build shell and panels | `src/components/mind/build-workspace.tsx` | `PARTIAL` — control plane exists; hosted runtime is not connected |
| Companion ACP worker | `agent/windows/KimiAcpClient.mjs` | `PARTIAL` — later Windows target, not the website release |
| Session, file, terminal, cancel APIs | `src/routes/api/mind/kimi/` | `PARTIAL` — authenticated, but they queue a paired PC |
| Phase 4 adapter | commit `eca065f4` on `manus/phase4-kimi-adapter` | `PARTIAL` — not yet merged; do not rewrite it |
| Auth, approvals, halt, MCP, providers | existing `src/lib/auth`, `src/lib/mind/pc-pairing`, `src/lib/mind/mcp`, `src/lib/mind/ai-provider-config.server.ts` | reuse |
| Production website project | existing `vercel.json` and `.vercel/output` | website host only |

## Execution order

### Step 1 — Make the current tree honest and green

Finish the four route types. Keep only controls that call a real endpoint. Run `tsc`, ESLint, and `npm run build`. Do not claim this step is the Kimi release.

### Step 2 — Merge the existing Phase 4 adapter

Bring `src/lib/mind/kimi/acp-phase4.ts`, its test, and its panel in from `eca065f4`. Connect it to real initialize/update events when a runtime exists. Until then the panel must say unknown, not available.

### Step 3 — Hosted runtime foundation

Create one gateway under `src/lib/mind/kimi/hosted/`. It is the only website path into Kimi. It must:

- read the runtime URL and service token from server environment only;
- return `NOT_CONFIGURED` when those values are absent;
- refuse to fabricate a session, file listing, or terminal result;
- record version, schema digest, and capability negotiation once a real runtime answers;
- support health, session create, prompt, event replay, and cancel.

The runtime itself runs on a persistent container or VM, not in the Vercel function. Provisioning that host is a paid-infrastructure step and is not implied by a local build.

### Step 4 — Core coding workflow

After the runtime answers, connect Build to hosted projects and sessions. File explorer, editor, diff, terminal, and Git call the gateway. Destructive commands keep the existing approval record.

### Step 5 — Advanced capabilities

Subagents, skills, plugins, MCP, and hooks are enabled only after the pinned runtime reports them. The existing MCP registry stays the source of truth. Unsupported items stay `UNSUPPORTED`.

### Step 6 — Providers, attachments, and Adrian Speak

Reuse the existing credential vault. Voice submits a transcript into the active hosted session. Audio is not sent to ACP unless the runtime reports that capability.

### Step 7 — Security and operations

Owner isolation, path traversal, approval bypass, emergency stop, secret redaction, crash recovery, and event replay are tested against the hosted runtime. Mock tests do not close this phase.

### Step 8 — Preview, then production

Run the 30-step acceptance scenario in the blueprint. Record commit, runtime version, and evidence. Deploy the website through the existing Vercel project and the runtime through its persistent host. Then run the GitHub analysis against the deployed commit. Do not open a second production site.

### Step 9 — Windows Companion

After the hosted path is stable, the existing Companion becomes a second runtime target behind the same gateway contract. It is not required for the website release.

## Agent ownership

| Agent | May write | Must not touch |
| --- | --- | --- |
| Lead | shared integration, routes, Build mount | unrelated product modules |
| Runtime | `src/lib/mind/kimi/hosted/**` | Windows worker, auth, MCP registry |
| Adapter | files imported from `eca065f4` only | rewrite of that adapter |
| Matrix | `docs/KIMI_FEATURE_MATRIX.md` | application source |
| Release | `docs/KIMI_RELEASE_GATES.md` | production secrets and deploy commands |

## Current blockers that are not code gaps

- No pinned Kimi process is running in a persistent host.
- No runtime URL or service token is configured.
- `vercel` CLI is not available in this session, so a production deploy cannot be executed from here yet.
- No Windows device is attached. That does not block the hosted path.
- The current working tree is not committed. Production must deploy a recorded commit, not an uncommitted sandbox.
