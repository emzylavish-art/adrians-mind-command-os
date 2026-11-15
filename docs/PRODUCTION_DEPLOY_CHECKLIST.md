# Production deploy checklist

Status: drafted only. Nothing in this checklist has been deployed, pushed, or applied to production.

Candidate: `feature/adrian-build-kimi-hosted` at `8efad63570e5b8aac9a2dc5567caabcff8377f8d`.

This branch has no upstream. `origin/main` is still `0f08b03`. The live site `https://adrians-mind.vercel.app` is an older deployment. A Git commit is not a release.

## Stop here

Do not deploy, promote, push to `main`, or run SQL until both of these exist:

1. An explicit go-ahead for this exact commit.
2. A Vercel token supplied as a secret, not pasted into chat and not written into the repository.

The existing project is `adrians-mind`. Do not create a second production project. Do not touch Supabase projects `ybxowvzicirinpdcfyqe` or `espmxiitzucooxblmnpr`.

## What this release would change

The branch adds the hosted Kimi probe, the Kimi control-plane corrections, the send-row effort and style controls, honest Companion-offline Build copy, project archive and session rename, editor dirty-state protection, and a Grok label that changes only after a reply in the open chat.

It does not make Kimi coding work. The installed CLI can open a session, but this subscription does not include Kimi Code. Saved provider keys are still not injected into Kimi. Notion, Gmail, web search, MCP, and the Companion were not connected in the signed-in inspection.

The signed-in production chat check on the current live site did succeed. Grok answered one short message with `grok-4.20-0309-non-reasoning`. That proves the current site, not this branch.

## Additive Kimi tables

`migrations/0008_kimi_runtime.sql` only adds tables and indexes. It does not drop, alter, or rewrite existing tables, and it does not store secrets.

It creates, if missing:

- `mind_kimi_runtime`
- `mind_kimi_session`
- `mind_kimi_event`
- `mind_kimi_approval`
- `mind_kimi_extension`
- `mind_kimi_session_project_idx`
- `mind_kimi_event_session_idx`

`npm run build` runs `scripts/migrate.mjs`. On Vercel, only a production deployment may apply SQL. A preview deployment skips migrations even if it inherits `DATABASE_URL`. Each pending file runs in one transaction and is recorded in `_migrations`. A failed file is rolled back and is not recorded.

The production database already reports that `DATABASE_URL` or `POSTGRES_URL` is set. This sandbox cannot see `_migrations`, so it is not known whether `0001` through `0007` are recorded. A production build will apply every unrecorded file in `migrations/`, not only `0008`. Confirm that before the production build starts.

Leaving the new tables in place after a rollback is safe. They are empty until the new code writes to them. Do not drop them unless a separate instruction says so.

## Gates already passed locally

On this machine, `tsc --noEmit` passed. The composer mode tests passed, 4 of 4. `npm run build` completed. The migrator skipped because this machine has no database URL. A local preview rendered the new Build workspace and showed Companion offline, sign-in required, and a hosted attempt on submit. No coding task was executed.

## Before the go-ahead

Confirm the candidate is still `8efad63570e5b8aac9a2dc5567caabcff8377f8d`, or name a newer SHA explicitly.

Do not include the untracked audit notes, identity note, feature matrix, Notion source index, or Python cache files.

Keep the existing production environment. Do not rotate `DATABASE_URL`, `POSTGRES_URL`, `XAI_API_KEY`, `CONNECTOR_TOKEN_SECRET`, or auth secrets as part of this release. `KIMI_BIN` is optional. If it is unset, the server uses the command name `kimi`, which Vercel does not provide as a persistent worker. The website must not be described as running Kimi Code itself.

A preview deployment is the safer first look. It will not apply `0008`. It can show the new Build page, but it cannot prove the production migration.

## If go-ahead and a token are given

Push only `feature/adrian-build-kimi-hosted`. Do not merge it to `main` unless that is separately authorized.

Deploy through the existing `adrians-mind` project. Read the build log for `[migrate] applied 0008_kimi_runtime.sql` or `[migrate] up to date.` A preview log that says migrations were skipped is expected and is not production proof.

After Vercel reports READY, check that the production alias `https://adrians-mind.vercel.app` serves `8efad63`, or the newer SHA that was explicitly approved. A READY deployment object is not enough.

Then sign in and check these workflows:

- Chat still answers through the configured Grok path, and the provider label does not claim verification before a reply.
- Build opens the workspace, not the older “Let’s build” page.
- Companion offline stays honest. Submit shows the real hosted result. It must not invent output or ask for a Kimi login.
- A saved provider profile still says the key is not injected into Kimi.
- Project archive and session rename fail honestly when signed out, and persist only for the signed-in owner.
- Notion, Gmail, search, and MCP stay not connected unless a real connection check succeeds.
- Emergency stop still blocks a new action.

If the production alias does not match the approved SHA, or the migration log fails, promote the previous production deployment. Do not leave a failed build as the alias.

## Still blocked after a successful release

Kimi Code remains blocked until the account has that entitlement. File edits, terminal commands, and Git writes still require a paired Companion and an approved command. Provider keys remain stored but not injected. A successful deploy is not a verified coding task.
