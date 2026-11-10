# Manus — merge and deploy only

This is the only handoff. Older notes in this folder are background. Do not rebuild the product. Do not open a new Vercel project. Do not buy a model, voice key, avatar, database, or host. Do not call paid APIs to prove the deploy. Do not rewrite or force-push PR #50.

GrokBuild already built what can be built without those purchases. Your job is merge, then deploy the existing project.

## Identity

| Item | Value |
|---|---|
| GitHub | https://github.com/emzylavish-art/adrians-mind-command-os |
| PR #50 | https://github.com/emzylavish-art/adrians-mind-command-os/pull/50 |
| PR #50 branch | `feat/adrian-core-eve-personality-2026-11-10` |
| PR #50 head (must still be this) | `d4e600d2fbac035578771e6af2e191117ae83193` |
| PR #50 state | Draft. Base `main`. |
| PR #51 | https://github.com/emzylavish-art/adrians-mind-command-os/pull/51 |
| PR #51 branch | `feat/grokbuild-full-system-implementation` |
| PR #51 base | The PR #50 branch, not `main` |
| 3D figure commit | `eac45a44e5faf18e80e6c94156d6f0382414c15b` |
| Deploy candidate | Tip of `feat/grokbuild-full-system-implementation` after this file is on that branch. Confirm with `git rev-parse origin/feat/grokbuild-full-system-implementation`. |
| Vercel project | `adrians-mind` |
| Vercel project id | `prj_Q7tqShINgZgu0ZWkQNiIOG32WT0D` |
| Domain | https://adrians-mind.vercel.app |
| Production | Not deployed from these branches. Leave the current production deployment in place until the new one is READY. |

## Merge, in this order

1. Confirm PR #50’s head is still `d4e600d2fbac035578771e6af2e191117ae83193`. If it moved, stop. Do not force-push it.
2. Check out the tip of `feat/grokbuild-full-system-implementation`. It must contain `eac45a44e5faf18e80e6c94156d6f0382414c15b`.
3. On that exact tip:

```bash
npm ci
npm run typecheck
npm test
npm run build
```

`npm run build` also runs `scripts/migrate.mjs`. With no `DATABASE_URL` it skips. That skip is correct. `@tanstack/react-start` must stay `1.168.60` or newer (CVE-2026-102989). Do not downgrade it.

4. If any command fails, stop. Do not delete a failing test. Do not skip CI.
5. Mark PR #50 ready for review. It is a draft. Merge it into `main` with **Create a merge commit**. Do not squash. A squash copies the same changes under new SHAs and makes PR #51 conflict.
6. After #50 is on `main`, GitHub should retarget PR #51 onto `main`. If it does not, set PR #51’s base to `main` yourself. Then merge PR #51 with a merge commit. Do not squash. Do not force-push either branch.
7. If GitHub reports conflicts, stop and tell the owner. Do not rebase #50.

Deploy the `main` SHA that contains the tip of `feat/grokbuild-full-system-implementation`, after the four commands pass on that tip.

## Deploy

- Project `adrians-mind` / `prj_Q7tqShINgZgu0ZWkQNiIOG32WT0D` only.
- Do not create a second Vercel project or a second production app.
- Do not cancel a slow build.
- Point `adrians-mind.vercel.app` at the tested SHA only after the deployment is READY.
- If the new deployment fails, point the alias back at the previous READY deployment.
- Do not delete production data.
- Apply migrations only when this project already has its own Mind `DATABASE_URL` or `POSTGRES_URL`. Refuse Supabase refs `ybxowvzicirinpdcfyqe` and `espmxiitzucooxblmnpr`. Do not create a new database, and do not point this app at Oak Bridge or BridgePoint.

## What is already in the branch — do not rebuild

### EVE, visible in the existing app

Command home opens on her. Chat has the same figure, compact. The EVE Workbench has full, upper, face, and compact framing.

- Body: original Three.js geometry in `src/lib/mind/avatar/human-rig.ts`. Head, torso, arms, legs. Not a downloaded GLB, VRM, Ready Player Me file, or MetaHuman. No license was purchased.
- Face: her photograph, cropped onto the head. Plates live in `public/characters/`. See `public/characters/SOURCE.md`. Generated for this project. Not stock.
- Blink and a small gaze shift are painted on that photograph. The geometric eyes stay hidden so they do not double the photo.
- The head turns and the torso breathes unless `prefers-reduced-motion` is set.
- Speaking: the jaw opens by viseme (`aa`, `ee`, `oo`, `mm`, rest) and the face plate swaps when that character has the plate.
- MPEG Speak uses the real audio clock (`currentTime` / `duration`) from `SharedAudioOutput`. The mouth closes when playback ends or is interrupted.
- Live PCM has no duration. The mouth uses 55 ms per letter from the moment the spoken text is known. That is not sample-accurate. Do not claim that it is.
- If the portrait cannot load, the figure drops to the flat photograph and the caption says so. It does not pretend the 3D face loaded.
- Presence follows halt (offline), voice status, Speak errors, and saved runs in `waiting_approval` or `running`.

### Five characters, room for twenty

EVE, Liora, Iris, Luna, Aurora. All adult women. Capacity stays 10 female and 10 male (`src/lib/mind/characters`). Empty slots were left empty. They share one Adrian Core. They cannot grant tools or extra permissions. EVE has expression plates and four visemes. The other four have a closed mouth and an `aa` viseme.

### Voice identity

The selected character’s voice profile is what Speak and the live session use. Audible output needs `XAI_VOICE_API_KEY` or `VOICE_API_KEY` already on the server (`resolveVoiceApiKey`). Do not buy a key. Do not spend an existing key to record a demo. The silent orchestrator prompt stays exactly: `You are a silent speech-to-text capture helper. Do not speak replies; only transcribe the user.`

### EVE Workbench — already operational

Local fleet, not a mock: queue, pause, resume, cancel, approve, step, schedules, artifact download (`src/lib/mind/workbench-command.ts`). A failure returns the real reason. Emergency stop is server-enforced, also pauses schedules, and clearing it does not turn those schedules back on. Paperclip stays “not connected” until the four env vars below exist. No Paperclip write API was invented. The in-app browser is not a live signed-in Chrome. Do not claim computer-use ran.

### Already on PR #50 (`d4e600d`)

- Per-chat personalities. Unhinged is style only. Custom is bounded.
- EVE destination. It does not replace Chat, Agents, Runs, Connections, or the 3D Dashboard.
- Paperclip read-only HTTPS bridge with an owner allowlist. HTTP and embedded credentials are rejected.
- Local fleet leases, delegation, and schedules.
- Server halt plus the device emergency stop.
- MCP registry and call routes. OAuth route files. Voice realtime. Memory. Notion graph code.
- `scripts/mind-worker.mjs`: exit 2 and `Nothing ran` when no database URL; exit 1 on the two forbidden Supabase refs; with a URL it steps saved `mind_snapshot` rows only. It does not call models, Paperclip, a browser, or mail.

## Checks already run

- GitHub Actions on `eac45a44e5faf18e80e6c94156d6f0382414c15b` is green: `build`, `typecheck`, `script-tests`, `interface-inventory`, and `unit-tests` shards 0–3. PR #50’s Actions on `d4e600d2fbac035578771e6af2e191117ae83193` are green too. Re-run the four commands above on the tip you actually merge. A later docs-only commit does not change runtime code; if Actions is green on that tip, do not hunt a new failure.
- `npx tsc --noEmit` passed locally after the 3D figure.
- Avatar, viseme, character, and human-rig tests passed locally.
- Preview of the existing app: command home returned 200 on desktop and mobile, caption `EVE · LEAD OPERATOR IDLE`, the figure was on screen, no page errors, no horizontal overflow.
- A local `npm test` in the build sandbox can cancel `hang hits timeout → Status unavailable` in `src/lib/mind/service-board-status.test.ts` (`cancelledByParent`, event loop resolved before `AbortSignal.timeout`). That file is unchanged from before this work, and the same test passes in GitHub Actions. Do not edit it to chase the sandbox cancel.

## Secrets you may attach only if the owner already has them

Do not create accounts to obtain these.

| Name | Effect if missing |
|---|---|
| `DATABASE_URL` or `POSTGRES_URL` | Hosted snapshots and `node scripts/mind-worker.mjs` stay off. The worker exits 2. |
| `PAPERCLIP_API_URL` (https only), `PAPERCLIP_API_KEY`, `PAPERCLIP_COMPANY_ID`, `PAPERCLIP_OWNER_USER_ID` | Paperclip panel stays not connected. |
| `XAI_VOICE_API_KEY` or `VOICE_API_KEY` | No audible voice. Do not spend it for a demo. |
| `NOTION_TOKEN` | Notion stays unconfigured. The UI already says to set it and share pages. |
| `MIND_SEARCH_ENDPOINT` and `MIND_SEARCH_KEY` | Search stays unavailable. Both are required. |
| Google, Slack, GitHub OAuth client secrets | Those connections stay unproven. Do not paste user passwords into the repo. |

Model credits for xAI, OpenAI, Gemini, Anthropic, and OpenRouter stay unused. Do not call them.

## Still blocked — leave these unfinished

| Need | Why |
|---|---|
| A database URL on this Vercel project | Not created here. Never the two forbidden refs. |
| A supervised always-on worker | The script is safe and idle. It is not a paid host. |
| The four Paperclip vars | Live agents. Read-only bridge only. |
| A speech key already in env | Audible lip-sync proof. |
| OAuth client secrets plus the owner’s consent | Connections stay unproven. |
| Search endpoint and key | Search stays off. |
| A licensed face-rig vendor | Only if the owner later wants a scanned or MetaHuman face. Do not drop in an unlicensed GLB. The current body is the shipped model. |
| iPhone and the HP EliteBook | Physical devices. Pairing notes stay in `docs/hp-pairing`. |
| Chrome on `127.0.0.1:9222` | Not started. Do not claim the browser workspace drove a real desktop. |

## Do not claim any of these

- That EVE is a purchased photoreal face rig.
- That live PCM lip sync is sample-accurate.
- That Paperclip, browser computer-use, OAuth, or search ran live.
- That production was deployed by GrokBuild.
- That a second brain or a second Vercel app was created.

## If something fails, read these and stop

- This file.
- `.handoff/MANUS_TAKEOVER_2026-11-10.md` for the PR #50 scope.
- `docs/DIGITAL_HUMAN.md`
- `docs/EVE_WORKBENCH.md`
- `docs/EXTERNAL_BLOCKERS.md`
- `public/characters/SOURCE.md`

## After the alias is READY — owner look, no paid calls

Open https://adrians-mind.vercel.app. The command home should show EVE’s face and body, status idle. The workbench can queue a local task without a model call. Emergency stop pauses schedules. Paperclip still says not connected if the four vars are unset. Do not press Speak unless the owner asks to spend the existing voice key.
