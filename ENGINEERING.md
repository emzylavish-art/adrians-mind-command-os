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

The original master blueprint files are not in this repository. The list in `src/lib/mind/requirements.ts` is the inventory the app shows. It is not a certified copy of a missing blueprint.

## Stop reply after 78cf2a3

Stop this reply aborts the browser read and the server's outgoing xAI request. The provider response reader is canceled. The server emits `canceled` and does not emit `done`. The unfinished answer is not saved. Retry resends the same user message. Emergency stop is a separate control and still blocks new work.

Aborting the HTTP request does not guarantee that xAI will bill nothing. Tokens generated before the provider processes the abort can still be charged. The tests use a mocked fetch and do not call xAI.

The integrations list no longer treats a configured key as Ready. Grok and one-shot Speak are Configured. Local workspace lookup is Ready. The AI agent planner is Not implemented. REA doctor remains blocked because the environment is unhealthy. With `DATABASE_URL` unset, the server database is in-memory PGLite and is not cloud backup. A restart test against a real database was not run.

## Completion sprint after 7a0cdb6

The bounded planner can ask Grok to call only `list_projects`, `list_chats`, and `search_notes`. Arguments are validated. The run stops after four tool steps or twenty seconds, and Stop this run aborts it. Emergency stop also aborts an in-flight planner. It is not a general agent. Tests use a fake model. A live tool call was not sent.

Research still refuses when `MIND_SEARCH_ENDPOINT` or `MIND_SEARCH_KEY` is missing. When both are set, `performSearch` keeps at most eight hits that have a title and an http(s) URL. The screen renders only those links. Mock tests do not call a search API.

The chat model list enables Grok only when the server key is present, and labels it Configured, not live verified. GPT, Claude, Gemini, and OpenRouter stay disabled. A stored choice other than grok is ignored. Nothing is substituted.

`scripts/verify-grok.mjs` sends one short Grok request only when `MIND_LIVE_GROK=1`. The test suite runs it without that flag and expects a skip. It was not run with the flag.

`npm run db:migrate` still prints that `DATABASE_URL` is not set and skips. That is not cloud backup.

## Chat, provider, and research gate

Retry resends the last user message without adding a second copy. Regenerate is still the control when a reply already exists. Export chat downloads one conversation as JSON. Code fences can be copied as text.

A turn body may name a provider. An omitted name stays Grok 4.5. GPT, Claude, Gemini, and OpenRouter are refused before any model request, including when fallback is requested. Research does not open a chat and does not call Grok. `runResearch` returns no citations.

Spawned agents were not used for these edits so they would not write the same files at once. REA doctor remains unhealthy and was not treated as a passing inspection.

## Workspace shell and local worker after 3d38813

The navigation now includes Runs, Library, Connected, Tools, and Scheduled. Agent templates, a local `tickFleet` worker, schedule queueing, secret-free connection records, and not-connected mailbox records are in the browser snapshot. Hosted deploy only records `external-required`. `scripts/mind-worker.mjs` exits 2 when `DATABASE_URL` is unset.

REA doctor was run again: package 6.8.0, healthy false, Node 22.23.3, native engines missing, Grok Build registration missing. No target site was inspected on port 9222. Chromium opened one local HTML document through `scripts/mind-browser.mjs`. The product Open page button was not clicked. No model, search, image, or video credit was spent.

## Workspace shell after 49269f6

The sidebar is grouped and can collapse. On a phone the full list is a menu, with Command, Chat, Agents, and Runs on a bottom bar. The command palette searches destinations, agents, runs, chats, projects, notes, and files. Pins live in the browser snapshot. A custom agent stores only the tools you select. `buildTaskPlan` records ordered steps. Delegation stays at two children and one level. Failover defaults to none, so an unconfigured provider is not replaced. Appearance can be dark, light, or system in this browser.

A live model call was not spent. Gmail, search, and the hosted worker stay unavailable.


