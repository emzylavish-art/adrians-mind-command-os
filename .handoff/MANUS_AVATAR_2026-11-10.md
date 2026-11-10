# Manus handoff — digital human on top of PR #50

Manus merges, reconciles, and deploys. Do not open a new Vercel project. Do not buy a voice, model, avatar, or host. Do not call paid APIs to “prove” the deploy.

## Repository

- Repo: https://github.com/emzylavish-art/adrians-mind-command-os
- This branch: `feat/grokbuild-full-system-implementation`
- Parent (do not overwrite): `feat/adrian-core-eve-personality-2026-11-10` at `d4e600d2fbac035578771e6af2e191117ae83193`
- Existing draft PR: https://github.com/emzylavish-art/adrians-mind-command-os/pull/50
- Stack this branch on that branch. Do not force-push PR #50. Do not retarget PR #50 onto this work by rewriting its branch.
- Vercel project remains `adrians-mind` / `prj_Q7tqShINgZgu0ZWkQNiIOG32WT0D` / https://adrians-mind.vercel.app
- Production was not deployed from this branch.

## What this branch adds

A photographic digital human inside the existing app. Not a second site. Not a second brain.

- Canvas renderer: `src/components/mind/avatar/digital-human.tsx`
- Visemes, presence, session: `src/lib/mind/avatar/`
- Plates: `public/characters/` (EVE full set; Liora, Iris, Luna, Aurora portrait + `aa` only)
- License note: `public/characters/SOURCE.md` and `docs/DIGITAL_HUMAN.md`
- Shown in Chat (compact), the command home (compact), and the EVE Workbench (framing + expression + character select + voice preview)
- Speak MPEG playback drives the mouth from `SharedAudioOutput` currentTime. Interrupt closes the mouth.
- Live PCM has no duration, so the mouth uses 55 ms per letter from the moment the spoken text is known. That is not sample-accurate.
- Emergency stop sets presence offline. A saved run in `waiting_approval` or `running` sets those presences. Voice errors set error. Nothing is invented when a service is down.
- Characters still share Adrian Core. They do not grant tools. Orchestrator voice stays the silent transcription prompt.
- `src/lib/mind/avatar/visemes.test.ts` is on `package.json` `scripts.test`, so CI shards will run it.

## What was already on the parent commit

Workbench fleet controls, durable local core pass, hosted worker that exits 2 without `DATABASE_URL`, five characters, personality-aware direct voice, silent orchestrator, server halt. See `.handoff/MANUS_TAKEOVER_2026-11-10.md`. Do not redo that work.

## Avatar facts Manus must not upgrade in the release notes

- Rendering is a 2D canvas composite of original photographs. There is no rigged GLB, VRM, Ready Player Me asset, or commercial face SDK.
- Lip sync is letter-to-viseme, clipped to a mouth ellipse on the portrait. It is not audio-feature facial animation.
- EVE blinks by painting a short lid from a sampled forehead pixel. Eyes do not track. There is no separate eye model.
- Full body exists for EVE only, and only in full framing while she is not speaking.
- The other four women do not have expression plates. Male slots are empty on purpose.
- `prefers-reduced-motion` disables breath and blink.

## Verified on this machine before push

- `node --experimental-strip-types --test src/lib/mind/avatar/visemes.test.ts src/lib/mind/characters/index.test.ts src/lib/mind/voice/audio-output.test.ts` — 11 passed, 0 failed.
- `npx tsc --noEmit` — exit 0.
- `npm run build` — exit 0. Migrate skipped because `DATABASE_URL` / `POSTGRES_URL` were unset. Pre-existing CSS `@keyframes` warnings and large-chunk warnings remain. They are not from the avatar.
- `@tanstack/react-start` is 1.168.60.
- The full `npm test` suite was not re-run here. CI is the full run. Do not delete a failing test to go green.

## Still not done — do not mark these complete

| Need | Status |
|---|---|
| `DATABASE_URL` or `POSTGRES_URL` on the existing Vercel project | Hosted snapshots and `scripts/mind-worker.mjs` still exit without it. Forbidden refs `ybxowvzicirinpdcfyqe` and `espmxiitzucooxblmnpr` stay forbidden. |
| Supervised worker host | Not running. No new paid host. |
| `PAPERCLIP_API_URL`, `PAPERCLIP_API_KEY`, `PAPERCLIP_COMPANY_ID`, `PAPERCLIP_OWNER_USER_ID` | Read-only bridge only. UI stays “not connected” until set. No write API was guessed. |
| Speech key (`resolveVoiceApiKey`) | Preview and Speak do nothing audible without it. Do not spend it for a demo. |
| Model credits | Do not call xAI, OpenAI, Gemini, Anthropic, or OpenRouter to prove the deploy. |
| OAuth client secrets | Connect and revoke stay unimplemented live until the owner consents. |
| `MIND_SEARCH_ENDPOINT` and `MIND_SEARCH_KEY` | Search stays unavailable without both. |
| Licensed 3D / viseme vendor | Not purchased. Do not drop in an unlicensed GLB. |
| iPhone and HP EliteBook | Physical devices. Pairing docs stay in `docs/hp-pairing`. |
| Live browser / computer use | Local records only. A simulated browser is not shown as connected. |
| Knowledge-graph hydration and production migrations | Not applied. Migrate runs on production deploy only when the approved database URL is present. |

## Manus steps

1. Fetch `feat/grokbuild-full-system-implementation`.
2. Confirm PR #50’s branch is still `feat/adrian-core-eve-personality-2026-11-10` and was not rewritten.
3. Reconcile this branch onto that branch, or merge PR #50 first and then this PR.
4. Run `npm ci`, `npm run typecheck`, `npm test`, `npm run build` on the exact SHA you will deploy.
5. Deploy the existing Vercel project only. Keep the current production deployment until the new one is READY. Do not cancel a slow build. Confirm the alias points at the tested SHA.
6. Apply migrations only against the dedicated Mind database.
7. Tell Adrian which rows in the table above are still blocked. Do not describe the avatar as a 3D digital human.
