# Manus — one release handoff

This file replaces the earlier “not a 3D figure” note. Manus merges and deploys. Do not open a new Vercel project. Do not buy a model, voice, avatar, or host. Do not call paid APIs to prove the deploy. Do not rewrite PR #50.

## Ship these, in order

1. https://github.com/emzylavish-art/adrians-mind-command-os/pull/50
   Branch `feat/adrian-core-eve-personality-2026-11-10` at `d4e600d2fbac035578771e6af2e191117ae83193`.
   Personalities, EVE destination, local fleet controls, emergency stop that also pauses schedules, durable local core pass, worker that exits 2 with no database and refuses Supabase refs `ybxowvzicirinpdcfyqe` and `espmxiitzucooxblmnpr`.
2. https://github.com/emzylavish-art/adrians-mind-command-os/pull/51
   Branch `feat/grokbuild-full-system-implementation`. Base is the PR #50 branch, not `main`.
   Merge #50 first, then #51. Do not force-push #50.

Vercel project: `adrians-mind` / `prj_Q7tqShINgZgu0ZWkQNiIOG32WT0D` / https://adrians-mind.vercel.app
Production was not deployed from these branches.

## What the owner can already see

EVE is on the command home of the existing app: a 3D body (head, torso, arms, legs) with her photograph on the face. The same component is in Chat (compact) and the EVE Workbench (full, upper, face, compact).

- Model: `src/lib/mind/avatar/human-rig.ts`. Original Three.js geometry. Not a downloaded GLB, VRM, or Ready Player Me file. No license fee.
- Face plates: `public/characters/`. Generated for this project. See `public/characters/SOURCE.md`.
- Blink and a small gaze shift are drawn on the photograph. The head turns and the torso breathes. `prefers-reduced-motion` stops that.
- Jaw opening and the face plate follow letter visemes. MPEG playback uses the real audio clock. Live PCM uses 55 ms per letter because that audio has no duration. Both return to a closed mouth when speech stops.
- Five women: EVE, Liora, Iris, Luna, Aurora. Capacity remains 10 female and 10 male. Empty slots were not filled. They share Adrian Core and cannot grant tools.
- Workbench controls still call the local fleet: queue, pause, resume, cancel, approve, step, schedules, artifact download. Failures return the real reason. Emergency stop is server-enforced and pauses schedules. Clearing it does not re-enable schedules.
- Paperclip panel stays “not connected” until the four env vars exist. No write API was invented.

## Checks already run

- Avatar, character, viseme, and audio-clock tests passed (human rig included).
- `npx tsc --noEmit` passed after the 3D figure.
- An earlier `npm run build` passed on the photographic commit. Run it again on the SHA you deploy. Migrate skips when no database URL is set.
- `@tanstack/react-start` is 1.168.60.
- Full `npm test` was not re-run here. CI on the deploy SHA is the full run. Do not delete a failing test.

## Before you deploy

```bash
npm ci
npm run typecheck
npm test
npm run build
```

Keep the current production deployment until the new one is READY. Do not cancel a slow build. Point `adrians-mind.vercel.app` at the tested SHA. Apply migrations only on the dedicated Mind database. If the new deployment fails, point the alias back at the previous READY deployment. Do not delete production data.

## Still blocked — do not mark done

| Need | Why it is still open |
|---|---|
| `DATABASE_URL` or `POSTGRES_URL` on this Vercel project | Hosted snapshots and `node scripts/mind-worker.mjs`. Never the two forbidden refs above. |
| A supervised worker host | Always-on execution after the browser closes. No new paid host without a yes. |
| `PAPERCLIP_API_URL` (https), `PAPERCLIP_API_KEY`, `PAPERCLIP_COMPANY_ID`, `PAPERCLIP_OWNER_USER_ID` | Live Paperclip agents. |
| Speech key from `resolveVoiceApiKey` | Audible voice and live lip-sync proof. Do not spend it for a demo. |
| Model credits | Do not call xAI, OpenAI, Gemini, Anthropic, or OpenRouter. |
| Google, Notion, Slack, GitHub OAuth secrets plus consent | Those connections stay unproven. |
| `MIND_SEARCH_ENDPOINT` and `MIND_SEARCH_KEY` | Search stays unavailable without both. |
| A licensed facial-rig vendor, only if the owner wants a scanned or MetaHuman face | Do not drop in an unlicensed GLB. The current body is the shipped model. |
| iPhone and the HP EliteBook | Physical devices. Docs stay in `docs/hp-pairing`. |

## Do not claim

- That this is a purchased photoreal face rig.
- That live PCM lip sync is sample-accurate.
- That Paperclip, browser computer-use, OAuth, or search ran live.
- That production is deployed.
