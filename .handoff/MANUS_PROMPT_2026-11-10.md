# Manus — connections and deploy only

You are the release engineer. GrokBuild already wrote the product. You have the accounts, keys, database, and Vercel access. Do not rebuild the app. Do not open a new repository. Do not open a new Vercel project. Do not buy a model, voice, avatar, database, or host. Do not call a paid API to “prove” the deploy. Do not force-push. Do not squash.

Adrian pasted this prompt. The SHA at the top of his paste is the deploy candidate. It must match `origin/feat/grokbuild-full-system-implementation`. Product code ends at `0cd79ea4a748eb65759455b161dfa34ff30df616`. A later commit on that branch may only be this handoff. If the tip contains any other diff, stop and read it before you merge.

## 1. What you ship

Repository: https://github.com/emzylavish-art/adrians-mind-command-os

1. https://github.com/emzylavish-art/adrians-mind-command-os/pull/50
   - Draft. Mark it ready.
   - Branch `feat/adrian-core-eve-personality-2026-11-10`.
   - Head must still be `d4e600d2fbac035578771e6af2e191117ae83193`.
   - If that SHA moved, stop. Do not force-push this branch.
2. https://github.com/emzylavish-art/adrians-mind-command-os/pull/51
   - Branch `feat/grokbuild-full-system-implementation`.
   - Base is the PR #50 branch, not `main`.
   - Tip is the SHA Adrian pasted. Product commit is `0cd79ea4a748eb65759455b161dfa34ff30df616`.

`main` at handoff time was `fbd94766ecee85276db1fd39854e69f4807348f5`. Re-read `origin/main` before you merge. Do not reset it.

Vercel, existing project only:

- Name: `adrians-mind`
- Project ID: `prj_Q7tqShINgZgu0ZWkQNiIOG32WT0D`
- Domain: https://adrians-mind.vercel.app

Production was not deployed from these branches.

## 2. Merge, in this order

1. Check out a clean tree. Confirm PR #50’s head is still `d4e600d2fbac035578771e6af2e191117ae83193`.
2. Confirm PR #51’s tip is the pasted SHA and that `0cd79ea4a748eb65759455b161dfa34ff30df616` is an ancestor.
3. On that tip run:

```bash
npm ci
npm run typecheck
npm test
npm run build
```

`@tanstack/react-start` must be `1.168.60` or newer. If it is older, stop. Do not deploy a vulnerable Start package.

GitHub Actions was green on `eac45a44e5faf18e80e6c94156d6f0382414c15b` (build, typecheck, script-tests, interface-inventory, unit-tests 0–3) and on the PR #50 head. The routing commit is newer. Your four commands are the gate. Do not delete a failing test. Do not edit `src/lib/mind/service-board-status.test.ts` if a local sandbox cancels `hang hits timeout`. That file is unchanged and passes in Actions.

4. Mark PR #50 ready. Merge it into `main` with a merge commit. Do not squash. A squash makes PR #51 conflict with duplicated commits.
5. After #50 lands, GitHub may retarget #51 onto `main`. If it does not, change the base to `main` yourself. Then merge #51 with a merge commit. Do not squash. Do not force-push either branch.
6. If GitHub reports conflicts, stop. Do not rebase onto a rewritten #50. Do not delete EVE, the workbench, or the routing modes to “solve” the conflict.

`npm run build` runs `scripts/migrate.mjs`. With no `DATABASE_URL` it skips. That skip is correct. Do not treat the skip as a failed build.

## 3. Deploy the existing project

- Keep the current production deployment until the new one is READY.
- Do not cancel a slow build.
- Point `adrians-mind.vercel.app` at the tested `main` SHA only after READY.
- If the new deployment fails, point the alias back at the previous READY deployment.
- Do not delete production data.
- Do not create a second Vercel project.
- Apply migrations only if this project already has its own Mind `DATABASE_URL` or `POSTGRES_URL`.
- Refuse any URL containing Supabase refs `ybxowvzicirinpdcfyqe` or `espmxiitzucooxblmnpr`.
- Do not create a database. Do not use Oak Bridge or BridgePoint.
- Do not print secret values into logs, PR comments, or Notion.

## 4. Already built — do not rewrite

### EVE, the visible figure

- Command home shows her as soon as the app opens. Chat uses the compact frame. EVE Workbench can switch full, upper, face, and compact. Framing is stored at `amcos.avatar.framing.v1`.
- Body: `src/lib/mind/avatar/human-rig.ts`. Original Three.js geometry. Not a GLB, VRM, Ready Player Me file, or MetaHuman. No license fee.
- Face: `public/characters/`. Generated for this project. Read `public/characters/SOURCE.md` and `docs/DIGITAL_HUMAN.md`.
- Blink and a small gaze shift are painted on the photograph. The geometric eyes stay hidden so they do not double the photo. The head turns and the torso breathes unless `prefers-reduced-motion` is set.
- Jaw and the face plate follow visemes `aa`, `ee`, `oo`, `mm`, then rest. MPEG Speak uses `SharedAudioOutput` current time and duration. Live PCM has no duration, so the mouth uses 55 ms per letter. That is not sample-accurate. The mouth closes when speech stops or is interrupted.
- If the portrait fails, the stage drops to the flat photograph and the caption says so.

### Characters

EVE, Liora, Iris, Luna, Aurora. Capacity remains 10 female and 10 male. Empty slots were left empty on purpose. Do not invent people. They share Adrian Core. They cannot grant tools. EVE has expression plates and four visemes. The others have a closed mouth and an `aa` viseme. Code: `src/lib/mind/characters`.

### Voice

The selected character’s voice profile is passed into direct voice and the realtime session. Audible speech needs `XAI_VOICE_API_KEY` or `VOICE_API_KEY` already on the server. Do not buy a key. Do not spend one for a demo. The silent orchestrator prompt must stay exactly:

`You are a silent speech-to-text capture helper. Do not speak replies; only transcribe the user.`

### Routing

`src/lib/mind/routing-modes.ts`, shown in the composer as A Single, B Two models, C Panel, D Compare.

- A calls one model. No second call.
- B requires exactly two ready Astra, Sol, or Luna routes.
- C and D require at least two ready routes.
- Each ready route is called separately. Every reply is kept. `merge` is false. Do not add a silent organizer call.
- If a selected route is not ready, Send stops and the UI says nothing was sent.
- A 1–5 rating is stored in the browser with the message id, the model name, and the routing mode (`amcos.responseRatings.v1`). One rating is not proof of model quality.
- Direct / Orchestrator is a separate toggle. Orchestrator fan-out is not wired. The composer says so and Send stays on Direct. Do not pretend Ollama ran.

Unwired provider ids `anthropic`, `gemini`, `openrouter`, and `ollama` still do not send from the chat picker. `src/lib/mind/provider-call.ts` can call them only when a key exists and a caller passes it. The chat path does not do that. Do not flip that path on during the deploy.

### EVE Workbench and the local fleet

From PR #50, commit `d4e600d2fbac035578771e6af2e191117ae83193`:

- Queue, pause, resume, cancel, approve, step, schedules, artifact download.
- Failures return the real reason.
- Emergency stop is server-enforced. It pauses schedules. Clearing the stop does not re-enable them.
- Paperclip panel stays “not connected” until the four env vars below exist. The bridge is read-only HTTPS. HTTP, localhost, and embedded credentials are rejected. No write API was invented. Do not add one in the deploy.
- `scripts/mind-worker.mjs` exits 2 and prints `Nothing ran` when no database URL is set. It exits 1 on the two forbidden Supabase refs. With a dedicated URL it steps saved snapshots only. It does not call models, Paperclip, a browser, or mail.

### Personalities, memory, MCP, OAuth routes

- Per-chat personalities. Unhinged is style only. Custom is bounded.
- EVE is a destination. She does not replace Chat, Agents, Runs, Connections, or the 3D Dashboard.
- Memory and the Notion graph code exist. Notion stays unconfigured until `NOTION_TOKEN` or Notion OAuth is set.
- MCP registry and OAuth routes exist. A route existing is not a live connection.
- Usage from a real turn is recorded on the workspace when the provider returns token counts. Missing cost stays missing. Do not invent a price.

## 5. Connections — you set these, the code already reads them

Set a variable only if you already have the secret. If you do not, leave the feature visibly off. Do not create a new paid account to fill a gap.

| Name | What it unlocks | If you do not have it |
|---|---|---|
| `DATABASE_URL` or `POSTGRES_URL` | Hosted snapshots and `node scripts/mind-worker.mjs` | Worker stays off. The build skips migrate. |
| `PAPERCLIP_API_URL` | Must be `https`, no userinfo, no query, no localhost | Paperclip stays not connected |
| `PAPERCLIP_API_KEY` | Read-only bearer | Same |
| `PAPERCLIP_COMPANY_ID` | 4–100 chars, `[a-zA-Z0-9_-]` | Same |
| `PAPERCLIP_OWNER_USER_ID` | Only this user may read the roster | Same |
| `XAI_VOICE_API_KEY` or `VOICE_API_KEY` | Audible voice | Mouth can still time from text. Do not spend a key for a demo. |
| `XAI_API_KEY` | Grok chat, already the app path | Do not call it to test the deploy |
| `NOTION_TOKEN` | Internal integration. Share the pages with it | Notion stays unconfigured |
| `NOTION_OAUTH_CLIENT_ID`, `NOTION_OAUTH_CLIENT_SECRET`, `NOTION_OAUTH_REDIRECT_URI` | Notion OAuth, separate from the token | Leave unset if you use the token instead |
| `MIND_SEARCH_ENDPOINT` and `MIND_SEARCH_KEY` | Search. Both are required | Search stays off |
| `CONNECTOR_TOKEN_SECRET` | Encrypts stored OAuth tokens | Do not start OAuth without it |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | Gmail, Calendar, Drive, YouTube | Those cards stay not configured |
| `GOOGLE_OAUTH_GMAIL_REDIRECT_URI` | Gmail callback | |
| `GOOGLE_OAUTH_CALENDAR_REDIRECT_URI` | Calendar callback | |
| `GOOGLE_OAUTH_DRIVE_REDIRECT_URI` | Drive callback | |
| `GOOGLE_OAUTH_YOUTUBE_REDIRECT_URI` | YouTube callback | |
| `SLACK_OAUTH_CLIENT_ID`, `SLACK_OAUTH_CLIENT_SECRET`, `SLACK_OAUTH_REDIRECT_URI` | Slack | |
| `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`, `GITHUB_OAUTH_REDIRECT_URI` | GitHub OAuth for the product, not your git push | |

Callback paths already in the app. Register these, do not invent new ones:

- `https://adrians-mind.vercel.app/api/mind/oauth/gmail/callback`
- `https://adrians-mind.vercel.app/api/mind/oauth/google_calendar/callback`
- `https://adrians-mind.vercel.app/api/mind/oauth/google_drive/callback`
- `https://adrians-mind.vercel.app/api/mind/oauth/youtube/callback`
- `https://adrians-mind.vercel.app/api/mind/oauth/slack/callback`
- `https://adrians-mind.vercel.app/api/mind/oauth/github/callback`
- `https://adrians-mind.vercel.app/api/mind/oauth/notion/callback`

Drive’s scope in code is `drive.readonly`. A nightly write backup is not implemented. Do not claim a backup uploaded. Do not widen the scope during this deploy.

Astra, Sol, and Luna send only when their own route is ready (`ASTRA_API_KEY` / `SOL_API_KEY` / `LUNA_API_KEY`, or the existing OpenAI fallback the route already publishes). Do not add a new provider adapter in the deploy.

Do not call xAI, OpenAI, Gemini, Anthropic, or OpenRouter as a smoke test.

## 6. After the alias is READY

Open https://adrians-mind.vercel.app. No model call is required for these checks.

- Command home shows EVE’s face and body, status idle. Phone width does not overflow.
- Workbench can queue a local task. It shows a real waiting or running state. It does not call a model.
- Emergency stop pauses schedules. Clearing it leaves them paused.
- Routing buttons A, B, C, and D are visible. B, C, and D refuse to send until ready routes are selected.
- Paperclip says not connected if the four vars are missing.
- Notion, search, and OAuth say not configured if their secrets are missing. That is the correct result.
- Do not press Speak unless Adrian asks to spend the existing voice key.

If you did set `DATABASE_URL` on the dedicated Mind database:

- Confirm migrate ran against that URL only.
- Run `node scripts/mind-worker.mjs` once. It may step snapshots. It must not call a model. If the URL contains a forbidden ref, the process must exit 1.
- A supervised always-on host is still a separate decision. Do not buy one. One manual run is not 24/7.

If you did set Paperclip’s four vars:

- Reload the workbench. Connected means the read-only health, agents, and heartbeat calls succeeded. Templates in the repo are not live agents.
- Do not post a job. There is no write client.

## 7. Still blocked after a good deploy — do not mark these done

- A purchased or scanned face rig. The shipped body stays until Adrian approves a license.
- Sample-accurate live PCM lip sync.
- Orchestrator fan-out and a local Ollama conductor on the HP EliteBook.
- Always-on worker hosting.
- Google Drive nightly backup. Read-only scope only.
- Live browser computer-use. No signed-in Chrome was part of this handoff.
- Tauri on the HP EliteBook. The laptop was not here. Do not claim a desktop build.
- An iPhone app. Mobile web is responsive. A native app was not built.
- RAG embeddings. Do not fabricate citations. If search is unset, say search is off.
- OpenRouter, Gemini, Anthropic, and Ollama as chat sends. They stay unwired on the picker.

## 8. If something fails

Stop. Put the alias back on the previous READY deployment. Do not rebuild EVE. Do not replace the Three.js body with a downloaded GLB. Do not “fix” a red test by deleting it. Report the command, the SHA, and the error.

Read, in this order, if you need the source of a claim:

- `.handoff/MANUS_PROMPT_2026-11-10.md` (this file)
- `.handoff/GROKBUILD_STATUS.md`
- `.handoff/MANUS_TAKEOVER_2026-11-10.md` (PR #50 scope)
- `docs/DIGITAL_HUMAN.md`
- `docs/EVE_WORKBENCH.md`
- `docs/EXTERNAL_BLOCKERS.md`
- `public/characters/SOURCE.md`
