# Manus takeover — no loose ends

Prepared after the assistant implementation on branch `feat/adrian-core-eve-personality-2026-11-10`.
Manus owns reconciliation check, merge, production deploy and live verification.
Do not open a new Vercel project. Do not buy services. Do not call paid models to "test".

## Already in the branch before this handoff

- Per-chat personalities, including bounded Custom and Unhinged-as-style-only.
- Personality forwarding on direct, logic-route and provider paths.
- EVE destination that does not replace Chat, Agents, Runs, Connections or the 3D Dashboard.
- Paperclip read-only HTTPS bridge (`src/lib/mind/paperclip-bridge.server.ts`) with owner allowlist.
- Local fleet: enqueue, pause, resume, cancel, approve, schedules, leases, delegation.
- Server emergency halt (`setExecutionHalt`) plus device emergency stop.
- MCP registry, OAuth routes, voice realtime, memory, Notion graph code.
- CI was green at `6b71c4592434931a88218e06a91a5bd4c9d63928` (8/8). That SHA is not the final SHA after the commit below.

## What this commit adds

Commit message: `Make EVE Workbench operate on the real local fleet`.

- Workbench queue / pause / resume / cancel / approve / step / schedule controls (`src/lib/mind/workbench-command.ts`). Failures return the real reason.
- Emergency stop also pauses schedules and does not re-enable them on clear (`command-app.tsx`).
- One durable local pass (`src/lib/mind/core-runtime.ts`) plus authenticated `runDurableCorePass`.
- `scripts/mind-worker.mjs` still exits 2 with no database and still refuses the forbidden Supabase refs. When a database URL is present it runs `scripts/core-worker-pass.mjs`, which steps saved snapshots only. It does not call models, Paperclip, browsers or mail.
- Five female presentation characters (`src/lib/mind/characters`). Capacity 10 female / 10 male. No extra characters were invented. No permissions.
- Direct voice and the overlay realtime session receive the active chat personality and selected character. Orchestrator mode remains the exact silent transcription prompt.
- Docs: `docs/EVE_WORKBENCH.md`.

## Verify before merge

From a clean checkout of this branch:

```bash
npm ci
npm run typecheck
npm test
npm run build
```

New tests that must pass:

- `src/lib/mind/characters/index.test.ts`
- `src/lib/mind/voice-live/session-instructions.test.ts`
- `src/lib/mind/workbench-command.test.ts`
- `src/lib/mind/core-runtime.test.ts`
- `scripts/mind-worker.test.mjs` (still expects exit 2 and "Nothing ran" when no database URL)

Reconcile with `main` (`fbd94766ecee85276db1fd39854e69f4807348f5` at handoff time). PR #50 was mergeable and draft. Do not merge until the commands above pass on the exact SHA you deploy.

## Production release — Manus only

- Vercel project: `adrians-mind`
- Project ID: `prj_Q7tqShINgZgu0ZWkQNiIOG32WT0D`
- Domain: https://adrians-mind.vercel.app
- Keep the current production deployment until the new deployment is READY.
- Do not cancel a slow build.
- Confirm the alias points at the tested SHA.
- Apply pending migrations only on the dedicated Mind database. Refuse `ybxowvzicirinpdcfyqe` and `espmxiitzucooxblmnpr`.
- Do not create a second production app.

## Owner actions still required — blocked, not done

Do not mark these complete. Each one needs a credential or a machine the repository does not have.

| Need | Blocks | Owner action |
|---|---|---|
| `DATABASE_URL` or `POSTGRES_URL` on the existing Vercel project, dedicated to this app | Durable server snapshots and the hosted worker | Create or attach the already-approved database. Never use Oak Bridge, BridgePoint, or the two forbidden refs. |
| A supervised process running `node scripts/mind-worker.mjs` on a host that can see that database | Always-on execution after the browser closes | Approve the host. No new paid host without an explicit yes. Node on the CI image is 24.11.1; Paperclip's own host floor is still Node >= 24.11 if Paperclip itself is installed. |
| `PAPERCLIP_API_URL` (https only), `PAPERCLIP_API_KEY`, `PAPERCLIP_COMPANY_ID`, `PAPERCLIP_OWNER_USER_ID` | Live Paperclip agents and heartbeats | Provision Paperclip, then set the four variables. The UI already reports "not connected" until then. |
| Speech key used by `resolveVoiceApiKey` (not the chat key) | Live voice, TTS, the voice session | Add the key. Do not spend it for a demo without approval. |
| xAI / OpenAI / Gemini / Anthropic / OpenRouter credits | Live chat and tool-calling tests | Owner already reported credit exhaustion. Do not call them to prove the deploy. |
| Google / Notion / Slack / GitHub OAuth client secrets | Connect, revoke and tool execution against those accounts | Create the OAuth clients and complete consent in the browser. |
| `MIND_SEARCH_ENDPOINT` and `MIND_SEARCH_KEY` | Web research tool | Set both or leave search honestly unavailable. |
| Avatar / lip-sync vendor | Face, eye contact, lip-sync | Not implemented. Do not fake a video avatar. |
| iPhone and the HP EliteBook | Home-screen install and PC pairing | Physical devices. Pairing docs stay in `docs/hp-pairing`. |

## Acceptance that is still unverified

Implemented and unit-tested, not production-verified:

- Workbench local controls and emergency-stop schedule pause.
- Voice instruction assembly, including silent orchestrator mode.
- Character roster and voice id selection.
- One server snapshot pass when a database exists.

Not implemented, on purpose:

- A second intelligence brain.
- Fabricated Paperclip agents, fake browser sessions, or fake lip-sync.
- Purchasing Paperclip hosting, voice credits, avatar credits, or a new database.
- Merging PR #50 or deploying production.

## Rollback

If the new production deployment fails, point `adrians-mind.vercel.app` back at the previous READY deployment. Do not delete production data. The worker pass only updates `mind_snapshot` payloads for users who already had a snapshot; it does not drop tables.
