# `8efad63` compared with `origin/main`

Compared: `feature/adrian-build-kimi-hosted` at `8efad63570e5b8aac9a2dc5567caabcff8377f8d` against `origin/main` at `0f08b03be451d3af6f649824b3412a5ea45f3182`.

This is a Git comparison. It is not a claim that the live site serves `origin/main`. The last signed-in inspection still showed the older Build page, which is not the Build workspace already present on `origin/main`.

Nothing in this comparison has been pushed or deployed.

## Commits not on `origin/main`

- `32b1dce` Add the hosted Kimi ACP probe.
- `d1101fe` Add the missing Kimi runtime tables.
- `c37a068` Correct the hosted Kimi session path and stop claiming unverified features are complete.
- `30f65bc` Make the composer and Build states match what actually runs.
- `45c7823` Keep Build file saves tied to the last verified content.
- `f7db7a9` Record the local preview evidence for the Build workspace.
- `8efad63` Mark Grok verified only after a reply in the open chat.

## Production behavior that would change

Build no longer refuses to submit when no Companion is online. If no Companion has a heartbeat, `/api/mind/kimi/session` starts `kimi acp`, records the attempt, and returns the real refusal. It does not invent success and it does not ask the user to log in to Kimi. The Build status says “Hosted attempt on submit” instead of “Nothing runs.”

`GET` and `POST /api/mind/kimi/runtime` are new. A signed-in call probes the Kimi CLI. It can report a created session, an authentication block, or a missing command. `taskCompleted` stays false.

Capability labels for task submit, agent output, file browse, and session create/cancel are `limited`, not `fully_integrated`.

The Windows Companion dispatcher also accepts approved `shell` jobs. The worker already handled that kind. This does not run on Vercel by itself.

The editor warns before leaving unsaved text, disables Save until the text differs from the last read or verified write, and only reports a save when the file operation returns a path.

Registered projects can be opened and archived, and saved sessions can be renamed, through the existing project API.

Effort and conversation style sit on both send rows. Choosing Orchestrator switches the existing voice route and falls back to Direct when no computer is paired. Text send stays on Direct. Grok’s provider label says a reply came from Grok only when the open chat has an assistant message whose model name contains `grok`.

Module pages other than chat, dashboard, and intelligence keep bottom padding so the fixed Speak control does not cover the last lines.

## Files that would ship

Runtime and server files: `src/components/mind/build-workspace.tsx`, `src/components/mind/command-app.tsx`, `src/lib/mind/composer-modes.ts`, `src/lib/mind/kimi/acp.server.ts`, `src/lib/mind/kimi/capabilities.ts`, `src/lib/mind/kimi/hosted/acp-client.ts`, `src/lib/mind/kimi/hosted/runtime.server.ts`, `src/lib/mind/kimi/persist.ts`, `src/routes/api/mind/kimi/runtime.ts`, `src/routeTree.gen.ts`, and `agent/windows/MindAgent.ps1`.

Tests and notes that do not change the running site by themselves: `src/lib/mind/composer-modes.test.ts`, `src/lib/mind/kimi/hosted/acp-client.test.ts`, `scripts/kimi-schema.test.mjs`, `docs/ADRIAN_OS_DEEP_PRODUCT_MANDATE.txt`, `docs/PRODUCT_REALITY_2026-11-11.md`, and a test import change in `tools/notion/test_controller.py`.

No environment variable is added. `KIMI_BIN` remains optional. Vercel does not gain a persistent Kimi process merely by deploying this code.

## Migrations a live production build would apply

`npm run build` runs `scripts/migrate.mjs` only when `VERCEL_ENV` is `production` and `DATABASE_URL` or `POSTGRES_URL` is set. A preview build skips every migration.

The migrator reads only `migrations/*.sql`. It does not apply `migrations/auth/0001_auth.sql`.

It applies each basename that is absent from `_migrations`, in filename order, one transaction per file. The files on this commit are:

1. `0001_auth.sql`
2. `0002_mind.sql`
3. `0003_fleet.sql`
4. `0004_tool_run.sql`
5. `0005_custom_connection.sql`
6. `0006_ai_providers.sql`
7. `0007_oauth_connections.sql`
8. `0008_kimi_runtime.sql`

The only new file versus `origin/main` is `0008_kimi_runtime.sql`. It creates, if missing, `mind_kimi_runtime`, `mind_kimi_session`, `mind_kimi_event`, `mind_kimi_approval`, and `mind_kimi_extension`, plus two indexes. It does not drop or alter existing tables and does not store secrets.

This sandbox cannot see production `_migrations`. If `0001` through `0007` are already recorded, a live build applies only `0008_kimi_runtime.sql`. If any earlier name is missing from `_migrations`, that file is applied too. A failed file is rolled back and not recorded.
