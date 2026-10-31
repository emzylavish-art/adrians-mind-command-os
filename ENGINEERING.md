# Engineering handoff

Adrian's Mind, continuing from `125a57c`. Oak Bridge and BridgePoint were not opened or changed.

## Schema

`migrations/0001_auth.sql` is a byte-identical copy of `migrations/auth/0001_auth.sql`. `migrations/0002_mind.sql` adds owner-scoped `mind_snapshot`, `mind_control`, `mind_project`, `mind_chat`, `mind_memory`, `mind_file`, `mind_audit`, and `mind_usage`. Both are applied by the normal `migrations/*.sql` glob. A throwaway PGLite run created those tables. `DATABASE_URL` is not set, so `npm run db:migrate` skips Neon. The embedded database is not cloud backup.

If the browser and the server both already have data, the browser copy is kept. The server copy is replaced only when the owner chooses that in Settings.

## Auth and endpoints

Sign-in is on in this workspace. Grok, voice, REA, snapshot save/load, and emergency stop use server-side owner checks. `POST /api/mind/turn` returned 401 `Sign in is required.` with no session, and 403 `Forbidden: cross-site request blocked` for a scripted cross-site request. The model was not called. A different user cannot clear another owner's stop file. The page still loads when signed out.

The stop file under `.data/mind-halt` survives a process restart on this machine. It is not durable on a serverless disk. The SQL `mind_control` row is the durable record only after a dedicated `DATABASE_URL` exists.

## Performance

Send streams text into the chat and saves the reply only after a finished `done` event. A stopped, empty, or broken reply is not saved. Server snapshot writes skip an unchanged JSON payload. Normalizing 40 chats of 8 messages stays inside a 200ms test budget. Rate limits are in-process: chat 12/min, speak 8/min, REA 6/min, save 20/min. They reset when the process restarts.

## Verification

`npm test` passed (scripts, then the TypeScript suite, 0 failures). `tsc --noEmit` passed. `eslint .` passed. `npm run build` passed. Dev and production preview both rendered Adrian's Mind on desktop and mobile with no console errors and no baseline divergence. `@tanstack/react-start` is 1.168.60.

## Still blocked

No dedicated database. The free organization is full, and the forbidden project refs are unused. REA doctor is not a healthy environment. `inspect-artifact` does not accept this app's source as evidence. Native engines are not installed. `ps` is unavailable, so `analyze-javascript-application` cannot run. Web research, image, and video are not connected. A live Grok stream was not spent during verification.

## Chat controls added after 165d18c

Rename, edit, regenerate, copy, and stop-this-reply are in the chat. Editing a user message removes every later message and sends the edited text once. Stopping a reply does not save the unfinished text. Code fences render as text, not HTML.

Agents can run a three-step workspace lookup after approval: list projects, list chats, search notes. It does not call a model or the web. Choosing GPT, Claude, Gemini, or OpenRouter does not fall through to Grok.

REA doctor was run again. It is not healthy: Node 22.23.3 is below 22.23.4, and Hopper, Ghidra, IDA, and the other native engines are missing. They were not installed.

The original master blueprint files are not in this repository. The list in `src/lib/mind/requirements.ts` is the inventory the app shows.

## Chat, provider, and research gate

Retry resends the last user message without adding a second copy. Regenerate is still the control when a reply already exists. Export chat downloads one conversation as JSON. Code fences can be copied as text.

A turn body may name a provider. An omitted name stays Grok 4.5. GPT, Claude, Gemini, and OpenRouter are refused before any model request, including when fallback is requested. Research does not open a chat and does not call Grok. `runResearch` returns no citations.

Spawned agents were not used for these edits so they would not write the same files at once. REA doctor remains unhealthy and was not treated as a passing inspection.

