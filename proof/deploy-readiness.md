# Deploy-readiness checklist

Status date: 2026-11-15. This is not a PASS ledger for Blueprints 92, 93, or 94. Issue 48 stays OPEN. A local proof does not close a higher question. Production is not ready for the merge-and-deploy approval.

## Local preview proofs

| Proof | Status | Evidence |
| --- | --- | --- |
| Cannot-run labels include browser pointer and microphone after the tab closes | PASS | proof/phone/cannot-run.png |
| Hosted file write after exact approval | PASS | proof/phone/hosted-approvals.png |
| Hosted file delete after exact approval | PASS | proof/phone/hosted-approvals.png |
| Hosted terminal after exact approval | PASS | Hosted terminal finished. hosted-ok |
| Hosted file read after the file exists | PASS | proof/phone/hosted-read-after-write.png |
| Speak place call returns a spoken reply and has no emergency stop | PASS | proof/phone/speak-close-proof.png |
| Phone groups open: Research, Library, Scheduled, Build, EVE | PASS | click-through in proof/local-close.mjs |
| Windows installer contains the permission script | PASS | public/downloads/AdriansMind-Setup.exe |
| Installer installed on a Windows PC | FAIL | No PC was available |
| Windows granted every requested permission | FAIL | The script does not claim a grant Windows did not make |

## Issue 48

| Gate | Status | Missing evidence |
| --- | --- | --- |
| Every typecheck, script test, unit test shard, build, static audit and migration test passes on exact deployment SHA. | FAIL | No production SHA test, and this local preview does not satisfy it. |
| Production Postgres migrations 0006 and 0007 are applied, with safety/backup verification; no forbidden DB identifier. | FAIL | No production SHA test, and this local preview does not satisfy it. |
| User secrets encrypted and never exposed in browser or logs. | FAIL | No production SHA test, and this local preview does not satisfy it. |
| Persistent credentials and sessions survive restart, auth callback and deployment. | FAIL | No production SHA test, and this local preview does not satisfy it. |
| Browser smoke tests: auth, navigation, responsive UI, browser console, all API error states. | FAIL | No production SHA test, and this local preview does not satisfy it. |
| Provision approved always-on Node.js >=24.11 host (no purchase without approval). | FAIL | No production SHA test, and this local preview does not satisfy it. |
| Verify pinned Paperclip package and authenticated service health. | FAIL | No production SHA test, and this local preview does not satisfy it. |
| Configure separate durable database, backups and budget controls. | FAIL | No production SHA test, and this local preview does not satisfy it. |
| Connect GitHub read-only, run exactly one authenticated Codebase Auditor agent. | FAIL | No production SHA test, and this local preview does not satisfy it. |
| Confirm actual job execution/reporting, task status, errors and spending. | FAIL | No production SHA test, and this local preview does not satisfy it. |
| Add authenticated server-only status/task adapter to Adrian's Mind. | FAIL | No production SHA test, and this local preview does not satisfy it. |
| Map Paperclip agent/heartbeat/run data onto 3D graph and Runs/Tasks screens. | FAIL | No production SHA test, and this local preview does not satisfy it. |
| Grant code-write or production permissions only with explicit approved policy. | FAIL | No production SHA test, and this local preview does not satisfy it. |
| Custom model API connection: key save, discovery, selection, chat, text+tools/vision capability handling. | FAIL | No production SHA test, and this local preview does not satisfy it. |
| OpenAI, xAI, Gemini, Anthropic, OpenRouter adapters; normalize streaming, error and history. | FAIL | No production SHA test, and this local preview does not satisfy it. |
| MCP URL connect, OAuth/bearer, transport/session negotiation, tools/list, schema args, tools/call. | FAIL | No production SHA test, and this local preview does not satisfy it. |
| AI tool broker: natural-language tool selection, per-write approvals, audit events, tool results returned to model. | FAIL | No production SHA test, and this local preview does not satisfy it. |
| Gmail, Drive, Calendar, GitHub, Notion, Slack, YouTube authorisations and operations. | FAIL | No production SHA test, and this local preview does not satisfy it. |
| Fix Speak regression; verify xAI Eve TTS, STT, realtime speech, mute, interrupt and selected-voice identity. | FAIL | No production SHA test, and this local preview does not satisfy it. |
| Create original waist-up adult female avatar with eye contact, idle/listen/think/speak/error states and lip-sync. | FAIL | No production SHA test, and this local preview does not satisfy it. |
| Verify Graph/Universe switch, WebGL fallback, search, node select, zoom, mobile Safari. | FAIL | No production SHA test, and this local preview does not satisfy it. |
| Hydrate genuine Notion graph data and Paperclip runtime telemetry; distinguish unavailable sources. | FAIL | No production SHA test, and this local preview does not satisfy it. |
| Implement/reuse supervised background worker with queue, retries, schedules, cancellation and recovery. | FAIL | No production SHA test, and this local preview does not satisfy it. |
| Verify project/file/memory/history tools, actions and persistence. | FAIL | No production SHA test, and this local preview does not satisfy it. |
| Verify every UI control with browser action, authenticated backend result, persistence and accurate feedback. | FAIL | No production SHA test, and this local preview does not satisfy it. |

## Blueprint 92

359 tagged questions. Every one is FAIL. There is no PASS ledger entry with the required proof level.

| ID | Level | Status | Missing evidence |
| --- | --- | --- | --- |
| INT-01 | A | FAIL | No ledger proof at level A. Does an Intelligence Layer exist as server code today? Name the files, routes and services. If only a model selector exists, say so. |
| INT-02 | A | FAIL | No ledger proof at level A. Is there a written definition of the Intelligence Layer's responsibilities that matches B1 and B2? Is it in the repository docs? |
| INT-03 | B | FAIL | No ledger proof at level B. How does a person reach it? (Every surface routes into it: Chat, Eve, Human Code, Quick bar.) Is there a quick bar reachable from every s... |
| INT-04 | C | FAIL | No ledger proof at level C. When the person types or says "create a project called Marina, add three tasks, and ask the research agent to find zoning rules", what ex... |
| INT-05 | D | FAIL | No ledger proof at level D. Is there a capability registry? List every capability, its input schema, output schema, permission class and side effects. |
| INT-06 | D | FAIL | No ledger proof at level D. Does every module register its capabilities (Projects, Agents, Build, Research, Files, Integrations, Memory, Scheduled, Notifications, Br... |
| INT-07 | D | FAIL | No ledger proof at level D. Does the planner produce a visible plan before side-effecting work starts? Where is it stored? |
| INT-08 | D | FAIL | No ledger proof at level D. Can the planner choose between capabilities correctly? Provide 30 test requests with expected capability sequences and the measured accur... |
| INT-09 | D | FAIL | No ledger proof at level D. Which model runs the planner, and what is the fallback when it fails or returns an invalid plan? |
| INT-10 | D | FAIL | No ledger proof at level D. How are capability inputs validated before execution? What happens on invalid input? |
| INT-11 | E | FAIL | No ledger proof at level E. Is there a durable task record for every request that does work (id, owner, project, status, steps, inputs, outputs, errors, cost, timest... |
| INT-12 | E | FAIL | No ledger proof at level E. Can a task be reopened after a refresh, a new session and a different device, and show the same state? |
| INT-13 | E | FAIL | No ledger proof at level E. Are action receipts stored permanently and linked from the conversation? |
| INT-14 | C | FAIL | No ledger proof at level C. Does the reply visibly distinguish PROPOSED, EXECUTED and FAILED actions? Show all three states. |
| INT-15 | J | FAIL | No ledger proof at level J. Can the model ever say "done" without a receipt? Write a test that tries to make it claim an action it did not take, and prove the compos... |
| INT-16 | C | FAIL | No ledger proof at level C. What is the permission policy per capability class (read, write, spend, send, delete)? Is it editable by the owner in Settings? |
| INT-17 | C | FAIL | No ledger proof at level C. Is the approval flow usable on a phone, including when the app is in the background (notification, then approve)? |
| INT-18 | D | FAIL | No ledger proof at level D. Can the Intelligence Layer delegate to an Agent, to Build/Kimi, to Research and to the Browser, wait for each result and combine them? |
| INT-19 | D | FAIL | No ledger proof at level D. Does delegation create child task records with parent links, and can the person see the tree? |
| INT-20 | D | FAIL | No ledger proof at level D. Can it run steps in parallel when they are independent, and serialize when they depend? |
| INT-21 | F | FAIL | No ledger proof at level F. If one step fails, does it retry, skip, ask the person, or abort? Is the policy per capability and visible? |
| INT-22 | F | FAIL | No ledger proof at level F. If the connection drops mid-task, does the task continue on the server and reattach when the person returns without re-running steps? |
| INT-23 | F | FAIL | No ledger proof at level F. Are all side-effecting steps idempotent (an idempotency key per step), so a retry never creates a second project, second email or second ... |
| INT-24 | F | FAIL | No ledger proof at level F. What happens when two requests that touch the same project arrive at once? Is there locking or ordering? |
| INT-25 | G | FAIL | No ledger proof at level G. What is the time from request to first visible plan? To first receipt? Provide baseline and after measurements. |
| INT-26 | H | FAIL | No ledger proof at level H. Does the Intelligence Layer load the right memory, project and conversation context for each step, and only that (no cross-project leakag... |
| INT-27 | H | FAIL | No ledger proof at level H. Can Eve, Chat, Human Code and Agents all invoke the same capabilities through the same path? Show one request made from each surface prod... |
| INT-28 | I | FAIL | No ledger proof at level I. Can the Intelligence Layer be tricked by text inside a web page, a file or an email into executing a forbidden action (prompt injection)?... |
| INT-29 | I | FAIL | No ledger proof at level I. Does it respect the per-user permission policy and never act with another user's credentials? |
| INT-30 | I | FAIL | No ledger proof at level I. Is every capability call written to the Activity log with who, what, inputs (redacted), result and time? |
| INT-31 | G | FAIL | No ledger proof at level G. What is the cost per request class, and does the layer enforce budgets and stop politely when one is reached? |
| INT-32 | C | FAIL | No ledger proof at level C. Can the person interrupt a running task ("stop", "change the plan", "skip step 3") and have the layer obey? |
| INT-33 | C | FAIL | No ledger proof at level C. Can the person ask "what are you doing right now?" and get a truthful answer from the task ledger, not from model imagination? |
| INT-34 | C | FAIL | No ledger proof at level C. Can the person ask "what did you do yesterday?" and get answers from receipts? |
| INT-35 | J | FAIL | No ledger proof at level J. What end-to-end test proves JOU-04 (the project and agents journey) passes, and at what level of proof (E3)? |
| EVE-01 | A | FAIL | No ledger proof at level A. Where is Eve in the app today? Is she a separate module or only a voice screen with an orb? Document honestly. |
| EVE-02 | B | FAIL | No ledger proof at level B. How does the person open Eve: from the mode switch, a floating button, a wake action, a lock-screen shortcut, the Home Screen app icon? W... |
| EVE-03 | A | FAIL | No ledger proof at level A. Is there an avatar? Is it photoreal? Is it a generated or licensed asset? Is the asset register filled in (source, license, date)? |
| EVE-04 | A | FAIL | No ledger proof at level A. Does the avatar have meaningful states: idle, listening, thinking, speaking, interrupted, happy, concerned, curious, sleepy? List which e... |
| EVE-05 | C | FAIL | No ledger proof at level C. Do state changes happen at the right moments and match the true conversation state (BLUEPRINT 2, D1)? Is there a debug overlay showing th... |
| EVE-06 | D | FAIL | No ledger proof at level D. Is the mouth animation driven by the actual speech audio (visemes or audio level), or is it a canned loop? Measure the sync error in mill... |
| EVE-07 | G | FAIL | No ledger proof at level G. What frame rate does the avatar achieve on a mid-range iPhone, and what is its battery and heat impact over a 10-minute conversation? |
| EVE-08 | F | FAIL | No ledger proof at level F. What does the avatar show when audio is blocked, the network is lost, or the model fails? (No frozen "speaking" state.) |
| EVE-09 | D | FAIL | No ledger proof at level D. Does Eve listen hands-free, detect the end of a turn, and allow interruption? Measure barge-in stop time. |
| EVE-10 | E | FAIL | No ledger proof at level E. Does Eve remember conversational context across a call, across calls, and across Chat and Human Code? Prove with a test. |
| EVE-11 | H | FAIL | No ledger proof at level H. Is Eve's brain the Intelligence Layer? Can she start a research task, create a project, check a Build task, add a note, by voice, and spe... |
| EVE-12 | H | FAIL | No ledger proof at level H. Can Eve hand a long result to the screen ("I've put that on screen") and reference it later? |
| EVE-13 | C | FAIL | No ledger proof at level C. Can the owner configure Eve's voice, speaking speed, personality style, name for the person, language and quiet hours? Do the settings ch... |
| EVE-14 | C | FAIL | No ledger proof at level C. Does Eve have a consistent personality across sessions? Where is the personality defined (a versioned prompt), and is there an eval set t... |
| EVE-15 | I | FAIL | No ledger proof at level I. Does Eve avoid claiming to be human or to have feelings she cannot have, when sincerely asked? Write tests. |
| EVE-16 | I | FAIL | No ledger proof at level I. Does Eve avoid manipulative engagement tactics (guilt, pressure, jealousy, exclusivity)? Write tests. |
| EVE-17 | I | FAIL | No ledger proof at level I. If a person expresses distress or crisis, does Eve respond with care and point to real-world help, not act as a replacement? Write tests ... |
| EVE-18 | I | FAIL | No ledger proof at level I. Is Eve clearly labeled as an AI in the interface? |
| EVE-19 | I | FAIL | No ledger proof at level I. Are voice recordings and transcripts stored only as the person allowed? Is there a visible recording indicator? |
| EVE-20 | F | FAIL | No ledger proof at level F. What happens after 30 minutes of continuous conversation: memory, battery, audio drift, reconnection? |
| EVE-21 | F | FAIL | No ledger proof at level F. What happens if the phone locks, a call arrives, headphones disconnect, or Bluetooth switches? |
| EVE-22 | B | FAIL | No ledger proof at level B. Does Eve work in the Safari tab and the Home Screen app? Which features differ? |
| EVE-23 | C | FAIL | No ledger proof at level C. Do Camera, Upload, Record and Screen buttons each do something real, with Eve describing what she sees? Test with a photo and a screenshot. |
| EVE-25 | J | FAIL | No ledger proof at level J. What recorded test proves JOU-02 passes? |
| CHT-01 | A | FAIL | No ledger proof at level A. What are the chat routes (page, API, streaming) and which files implement them? Draw the real request path from the Send button to the mo... |
| CHT-02 | C | FAIL | No ledger proof at level C. What happens on Enter, on Shift+Enter, on the Send button, on a long paste, on an empty message, on a message with only whitespace, on an... |
| CHT-03 | D | FAIL | No ledger proof at level D. Does the frontend send the correct payload (conversation id, model, project, attachments, idempotency key)? Show a captured request. |
| CHT-04 | D | FAIL | No ledger proof at level D. Does the server verify identity, resolve the model from the selector, call the correct provider, and stream the result? Show server logs ... |
| CHT-05 | D | FAIL | No ledger proof at level D. Is the model that the person selected the model that actually answered? Prove by asking each model to identify itself and by checking pro... |
| CHT-06 | C | FAIL | No ledger proof at level C. Does streaming render progressively on iPhone Safari without freezing the scroll or the keyboard? |
| CHT-07 | C | FAIL | No ledger proof at level C. Does Stop cancel the stream on the server (no further tokens, no further cost) and leave a consistent saved message? |
| CHT-08 | C | FAIL | No ledger proof at level C. Do Retry, Regenerate, Edit and Branch each work and preserve history correctly? |
| CHT-09 | C | FAIL | No ledger proof at level C. Does the model selector list only models that work, show provider status, and handle a model that disappears? |
| CHT-10 | E | FAIL | No ledger proof at level E. Does a conversation persist across refresh, new session, another device and after the browser data is cleared? |
| CHT-11 | E | FAIL | No ledger proof at level E. Are conversations stored per user and per project, and never mixed? Test with two accounts and two projects. |
| CHT-12 | E | FAIL | No ledger proof at level E. Are titles auto-generated and renamable; are pin, archive and delete real and complete? |
| CHT-13 | C | FAIL | No ledger proof at level C. Do attachments (photo, camera, PDF, text, spreadsheet, audio) upload, show progress, get processed and get used in the answer? List each ... |
| CHT-14 | F | FAIL | No ledger proof at level F. What does the person see for each failure: no network, provider 401, 429, 500, timeout, content refused, oversized message, expired sessi... |
| CHT-15 | F | FAIL | No ledger proof at level F. If the app closes mid-reply, is the partial reply kept, and can the person continue it? |
| CHT-16 | G | FAIL | No ledger proof at level G. Time from tap Send to first token on Wi-Fi and 5G; the distribution over 50 messages. Where is the latency (client, edge, database write,... |
| CHT-17 | G | FAIL | No ledger proof at level G. Are there unnecessary requests or re-renders during streaming? Measure renders per token and main-thread blocking. |
| CHT-18 | G | FAIL | No ledger proof at level G. Memory use after a 500-message conversation. Is the list virtualized? |
| CHT-19 | C | FAIL | No ledger proof at level C. Does markdown, code, tables, math and long links render correctly, with a working Copy on code blocks? |
| CHT-20 | H | FAIL | No ledger proof at level H. Can the Intelligence Layer be invoked from Chat? Does a Chat message like "start a research on X" produce a task, a receipt and a link? |
| CHT-21 | H | FAIL | No ledger proof at level H. Can Chat hand code questions to Human Code and tasks to Build, with context? |
| CHT-22 | H | FAIL | No ledger proof at level H. Can results from Research, Build and Agents be inserted into the chat as cards that open the source? |
| CHT-23 | I | FAIL | No ledger proof at level I. Can one user read another user's conversations by changing an id in a request? Test it. |
| CHT-24 | I | FAIL | No ledger proof at level I. Are attachments stored privately with signed, expiring links? |
| CHT-25 | C | FAIL | No ledger proof at level C. Does the effort control (Fast, Expert, Heavy, Auto) change model, token budget and tools? Show the mapping and prove each differs. |
| CHT-26 | C | FAIL | No ledger proof at level C. Do temporary chats really save nothing? |
| CHT-27 | C | FAIL | No ledger proof at level C. Does search over chat history work, including inside long conversations? |
| CHT-28 | J | FAIL | No ledger proof at level J. What recorded test proves JOU-01 passes, at what level of proof? |
| HUC-01 | A | FAIL | No ledger proof at level A. Does Human Code exist? Where? If not, specify and build it as a coding-focused conversation surface with its own thread list. |
| HUC-02 | B | FAIL | No ledger proof at level B. How does the person open it, and how does it differ from Chat in layout, purpose and defaults? |
| HUC-03 | C | FAIL | No ledger proof at level C. Does it have its own conversation history, separate from ordinary Chat, resumable by project and by repository? |
| HUC-04 | D | FAIL | No ledger proof at level D. Does it know the current project: file tree, open files, recent changes, branch, failing tests? How is that context gathered and bounded? |
| HUC-05 | D | FAIL | No ledger proof at level D. Can it read specific files and show them with syntax highlighting and line references? |
| HUC-06 | D | FAIL | No ledger proof at level D. Can it explain, review, debug and propose changes with exact file and line references? Provide ten test tasks on a real repository and gr... |
| HUC-07 | D | FAIL | No ledger proof at level D. Can it hand a task to Build with the context attached (files, conversation summary, constraints), and show the Build task inside the Huma... |
| HUC-08 | D | FAIL | No ledger proof at level D. Can it report Build results back into the thread (summary, diffs, test results) and discuss them? |
| HUC-09 | E | FAIL | No ledger proof at level E. Does the coding context persist across sessions and devices (open threads, last files, pending tasks)? |
| HUC-10 | E | FAIL | No ledger proof at level E. Can the person continue a previous coding conversation weeks later with the right repository state, noting where the code has since changed? |
| HUC-11 | D | FAIL | No ledger proof at level D. Which model does it use, and does it use the coding-appropriate model and tools (Kimi through Build for execution, a reasoning model for ... |
| HUC-12 | C | FAIL | No ledger proof at level C. Does it support slash commands and quick actions: /explain, /review, /fix, /test, /refactor, /plan, /run, /diff, each with real behavior? |
| HUC-13 | C | FAIL | No ledger proof at level C. Can the person attach screenshots of errors or logs and get useful analysis? |
| HUC-14 | C | FAIL | No ledger proof at level C. Can the person select a code range and ask about it (long press, then Ask)? |
| HUC-15 | F | FAIL | No ledger proof at level F. What happens when the repository is large, the context overflows, or a file cannot be read? |
| HUC-16 | F | FAIL | No ledger proof at level F. What happens when Build is unavailable (sandbox down, Kimi key invalid)? Does Human Code say so plainly and offer discussion-only mode? |
| HUC-17 | G | FAIL | No ledger proof at level G. Time to answer a question about a 200-file repository; how is the repository indexed and cached? Measure. |
| HUC-18 | H | FAIL | No ledger proof at level H. Can Eve and the Intelligence Layer open or resume Human Code threads ("continue the login bug discussion")? |
| HUC-19 | I | FAIL | No ledger proof at level I. Does it avoid exposing secrets from .env files and avoid sending them to providers? |
| HUC-20 | I | FAIL | No ledger proof at level I. Does it respect the repository permissions of the connected GitHub account? |
| HUC-21 | C | FAIL | No ledger proof at level C. Does the mobile layout allow reading code comfortably (horizontal scroll, wrap toggle, font size, pinch zoom)? |
| HUC-22 | J | FAIL | No ledger proof at level J. What recorded test proves JOU-03 passes? |
| BLD-01 | A | FAIL | No ledger proof at level A. Which file(s) implement Build today? Report the structure and size of `components/mind/build-workspace.tsx`, its imports and its state. |
| BLD-02 | A | FAIL | No ledger proof at level A. For each of Editor, Terminal, Browser and Capabilities: what handler runs when it is tapped, and what does it do? If nothing, fix it. |
| BLD-03 | B | FAIL | No ledger proof at level B. Can the person reach Build from the drawer, the mode pill, Human Code, Chat and a direct link? Does a deep link open the right workspace ... |
| BLD-04 | C | FAIL | No ledger proof at level C. Can the person create, select, rename, archive and delete workspaces and sessions? Do they persist? |
| BLD-05 | D | FAIL | No ledger proof at level D. Where does code run? Name the sandbox technology, region, limits and cost per hour. Show a command executing in it. |
| BLD-06 | D | FAIL | No ledger proof at level D. Is the working directory a persistent volume or repository checkout? What survives a restart? |
| BLD-07 | C | FAIL | No ledger proof at level C. Is there a file explorer with create, rename, move, delete, upload, download and search? Test each. |
| BLD-08 | C | FAIL | No ledger proof at level C. Is there an editor with syntax highlighting, search, undo, multi-file tabs and a phone-friendly key row? Test typing on iPhone. |
| BLD-09 | C | FAIL | No ledger proof at level C. Is there a diff viewer with approve, reject, approve-all and per-hunk actions? |
| BLD-10 | C | FAIL | No ledger proof at level C. Is there a terminal with live output, history, stop, and clear? Does it handle long output without freezing the phone? |
| BLD-11 | C | FAIL | No ledger proof at level C. Is there a preview pane that shows the running app and refreshes after changes? |
| BLD-12 | C | FAIL | No ledger proof at level C. Is there a Git tab (status, diff, stage, commit, branch, push, pull request) using the owner's connected GitHub? |
| BLD-13 | C | FAIL | No ledger proof at level C. Are permission requests shown, answered and enforced? Prove a denied command does not run. |
| BLD-14 | C | FAIL | No ledger proof at level C. Does cancellation stop the running process and the model call, and leave the workspace consistent? |
| BLD-15 | F | FAIL | No ledger proof at level F. What happens when the sandbox crashes, runs out of disk, times out, or loses network? Does the person get a clear message and a one-tap r... |
| BLD-16 | F | FAIL | No ledger proof at level F. What happens when the phone disconnects mid-task and returns an hour later? Does the sequence-numbered replay restore everything? |
| BLD-17 | E | FAIL | No ledger proof at level E. Are tasks, steps, events, diffs and outputs stored and visible on another device? |
| BLD-18 | G | FAIL | No ledger proof at level G. Cold start time, time to first token from the coding model, time to first file change, and terminal latency. Baseline and after. |
| BLD-19 | G | FAIL | No ledger proof at level G. Does the Build screen stay responsive when a task prints thousands of lines or edits hundreds of files? |
| BLD-20 | H | FAIL | No ledger proof at level H. Does Build use the owner's plugins and MCP servers, project instructions and Library? Show one task using each. |
| BLD-21 | H | FAIL | No ledger proof at level H. Can the Intelligence Layer, Human Code, Eve (by voice) and Agents create Build tasks and read results through the capability contract? |
| BLD-22 | I | FAIL | No ledger proof at level I. Is the sandbox isolated from the app's database, secrets and other users? Run an escape-attempt test suite. |
| BLD-23 | I | FAIL | No ledger proof at level I. Is outbound network restricted, and are blocked domains reported? |
| BLD-24 | I | FAIL | No ledger proof at level I. Are secrets masked in the UI and logs? |
| BLD-25 | C | FAIL | No ledger proof at level C. Does the test runner button detect and run the project's tests and show results in a readable summary? |
| BLD-26 | J | FAIL | No ledger proof at level J. What recorded test proves JOU-03 end to end (Human Code to Build to Kimi to diff to tests to result)? |
| BLD-27 | C | FAIL | No ledger proof at level C. Is the old planner form removed or demoted so there is a single clear path (workspace, task, plan, approve, result)? |
| KIM-01 | A | FAIL | No ledger proof at level A. Which upstream project and version is used (repository, tag or commit, license)? Is it the real Kimi Code CLI or a re-implementation or a... |
| KIM-02 | A | FAIL | No ledger proof at level A. Where is it installed (sandbox image, package manager, pinned version)? Show the build recipe and the version command output from inside ... |
| KIM-03 | D | FAIL | No ledger proof at level D. Which integration method is implemented: ACP, Wire, print mode, web mode, or raw terminal text? State why this one, and what the others l... |
| KIM-04 | D | FAIL | No ledger proof at level D. Does the real process launch on demand, with the right working directory, environment and configuration, in under the cold-start budget (... |
| KIM-05 | D | FAIL | No ledger proof at level D. Do sessions work: create, send prompt, receive streamed events, resume, list, delete? Show event logs for each. |
| KIM-06 | D | FAIL | No ledger proof at level D. Do prompts reach the Kimi model with the owner's key and the chosen model? Show provider-side usage for a test prompt. |
| KIM-07 | D | FAIL | No ledger proof at level D. Do all event types map to UI elements (BLUEPRINT 2, B5)? List every event type observed in real logs, and the element that renders it. Wh... |
| KIM-08 | D | FAIL | No ledger proof at level D. Do file operations work: read, write, edit, create, delete, search? Show diffs for each. |
| KIM-09 | D | FAIL | No ledger proof at level D. Do terminal operations work: run command, stream output, exit codes, long-running processes, stopping them? |
| KIM-10 | D | FAIL | No ledger proof at level D. Do permission requests arrive as events, reach the phone, and does the answer (deny, once, always) reach Kimi and change behavior? |
| KIM-11 | D | FAIL | No ledger proof at level D. Does cancellation stop Kimi's current turn, any running child process and any in-flight model call? |
| KIM-12 | D | FAIL | No ledger proof at level D. Do slash commands, plan mode, todo lists, compaction, sub-agents, skills, plugins and MCP servers work through the integration? Fill the ... |
| KIM-13 | D | FAIL | No ledger proof at level D. Is auto-approve (YOLO) off by default, clearly labeled when on, and scoped to one session? |
| KIM-14 | E | FAIL | No ledger proof at level E. Where do Kimi sessions, history and configuration live? Do they survive sandbox restarts and redeployments? |
| KIM-15 | E | FAIL | No ledger proof at level E. Is the project instruction file Kimi creates (via its init command) visible and editable, and is it versioned in the repository? |
| KIM-16 | F | FAIL | No ledger proof at level F. What happens when the Kimi key is invalid, expired, out of quota, or rate limited? Is the error specific and the next step clear? |
| KIM-17 | F | FAIL | No ledger proof at level F. What happens if the upstream version changes its event format? Is there a contract test that fails loudly in staging before production is... |
| KIM-18 | F | FAIL | No ledger proof at level F. What happens when Kimi hangs, loops, or exceeds the task budget? Is there a watchdog with a visible stop reason? |
| KIM-19 | G | FAIL | No ledger proof at level G. Latency from prompt to first streamed event; events per second the UI can render without jank; memory of the sandbox process after an hour. |
| KIM-20 | H | FAIL | No ledger proof at level H. Does Kimi inside Build use Adrian's connected MCP servers (GitHub, Notion), project instructions and the Library? Show one task for each. |
| KIM-21 | I | FAIL | No ledger proof at level I. Is the Kimi key injected only for the session and masked everywhere? Search logs and the browser for it. |
| KIM-22 | I | FAIL | No ledger proof at level I. Is the upstream license complied with (notices, attribution, trademark use)? Where is the open-source notices page? |
| KIM-23 | I | FAIL | No ledger proof at level I. Does the owner have a clear disclosure about code leaving to Moonshot's servers, with a per-workspace option to use another provider? (BL... |
| KIM-24 | J | FAIL | No ledger proof at level J. Which capabilities are NOT supported or incorrectly represented in Adrian's Mind today? Produce the list and the plan to close each. |
| KIM-25 | J | FAIL | No ledger proof at level J. Is there a scripted acceptance run (KC-1 to KC-18 in BLUEPRINT 2) that can be re-run after any Kimi update? |
| SPK-01 | A | FAIL | No ledger proof at level A. Draw the real voice pipeline as implemented: microphone, capture, transcription, model, speech synthesis, playback. Which provider and en... |
| SPK-02 | G | FAIL | No ledger proof at level G. MEASURE the lag the owner feels. Instrument and record, over 50 turns, each segment: tap to mic ready, end of speech to transcript, trans... |
| SPK-03 | G | FAIL | No ledger proof at level G. Is the transcript waited for in full, or streamed while the person speaks? Is the model reply waited for in full before synthesis, or sen... |
| SPK-04 | G | FAIL | No ledger proof at level G. Is a new connection created each turn (TLS, WebSocket) or is one kept open? Is the audio element or context created once? |
| SPK-05 | G | FAIL | No ledger proof at level G. Are audio formats and chunk sizes chosen for low latency on iPhone? Test alternatives and keep the fastest that works. |
| SPK-06 | C | FAIL | No ledger proof at level C. Does the person need to press anything between turns? List every required press. Remove all that are not essential (hands-free loop). |
| SPK-07 | C | FAIL | No ledger proof at level C. Does end-of-turn detection cut people off or wait too long? Test with fast talkers, slow talkers, pauses mid-sentence and background nois... |
| SPK-08 | C | FAIL | No ledger proof at level C. Does barge-in work, with a stop under 500 ms and honest history? |
| SPK-09 | D | FAIL | No ledger proof at level D. Is microphone readiness handled: permission state check, pre-prompt, recovery page, device change? |
| SPK-10 | D | FAIL | No ledger proof at level D. Does playback start from an unlocked audio object on iPhone Safari every time, including after the screen sleeps? |
| SPK-11 | E | FAIL | No ledger proof at level E. Are transcripts saved with timing and linked to the conversation? Can they be searched? |
| SPK-12 | F | FAIL | No ledger proof at level F. What happens on network loss mid-turn, a stalled synthesis request, a provider error, a mic that stops providing audio? Is there a spoken... |
| SPK-13 | F | FAIL | No ledger proof at level F. Are resources cleaned up (streams, audio nodes, sockets, timers) after a call ends or the page closes? Check for leaks after 20 calls. |
| SPK-14 | G | FAIL | No ledger proof at level G. Does a 30-minute call stay smooth: memory, CPU, audio drift, battery? |
| SPK-15 | C | FAIL | No ledger proof at level C. Do voice selection, personality, speed, activation mode and "My words" each change real behavior? |
| SPK-16 | C | FAIL | No ledger proof at level C. Is dictation for text fields separate from calls, resilient to pauses and long speech, and accurate for the owner's vocabulary? |
| SPK-17 | J | FAIL | No ledger proof at level J. Targets: first sound under 1.5 s typical; barge-in stop under 0.5 s; no required presses between turns. Show before and after measurement... |
| PRJ-01 | A | FAIL | No ledger proof at level A. What is a project in the data model? Fields, relations to conversations, files, tasks, agents, memory, Build workspaces, schedules and in... |
| PRJ-02 | C | FAIL | No ledger proof at level C. Create, rename, archive, restore, duplicate, delete a project. Does each propagate to children correctly? |
| PRJ-03 | C | FAIL | No ledger proof at level C. Does the person have a clear way to switch the active project, and does every module show which project it is acting in? |
| PRJ-04 | D | FAIL | No ledger proof at level D. Does each module use the active project's context only? Prove no leakage between two projects with similar content. |
| PRJ-05 | E | FAIL | No ledger proof at level E. Do project files, instructions, conversations and tasks persist and sync across devices? |
| PRJ-06 | C | FAIL | No ledger proof at level C. Are there project-level tasks with status, owner (person or agent), due date, and links to receipts? |
| PRJ-07 | C | FAIL | No ledger proof at level C. Is there a project activity timeline (who or what did what, when)? |
| PRJ-08 | H | FAIL | No ledger proof at level H. Can the Intelligence Layer create projects, tasks and notes and later report their state accurately? |
| PRJ-09 | H | FAIL | No ledger proof at level H. Can Build, Research, Agents and Eve save outputs into the project and open them from it? |
| PRJ-10 | C | FAIL | No ledger proof at level C. Is collaboration scoped (single owner now) and are sharing and roles defined for the future? Document the decision. |
| PRJ-11 | F | FAIL | No ledger proof at level F. What happens when a project with running tasks is archived or deleted? |
| PRJ-12 | I | FAIL | No ledger proof at level I. Are project permissions enforced server-side? |
| PRJ-13 | G | FAIL | No ledger proof at level G. Does a project with 1,000 items stay fast (pagination, indexes)? |
| PRJ-14 | C | FAIL | No ledger proof at level C. Can a project be exported (files, conversations, tasks) and imported? |
| PRJ-15 | J | FAIL | No ledger proof at level J. The two dead "external product" cards (Oak Bridge Capital, BridgePoint): what are they, and are they now working links or removed? |
| AGT-01 | A | FAIL | No ledger proof at level A. Which agents genuinely execute work today? List each template and prove one real run per agent (not a text reply). |
| AGT-02 | A | FAIL | No ledger proof at level A. Every "NOT LIVE" template: implement, or remove. |
| AGT-03 | C | FAIL | No ledger proof at level C. Create, edit, duplicate, delete an agent. Do changes affect the next run? |
| AGT-04 | D | FAIL | No ledger proof at level D. What does an agent run consist of: model, instructions, tools, knowledge, limits? Show the run record. |
| AGT-05 | D | FAIL | No ledger proof at level D. Which tools can agents call (the capability registry), and are tool permissions per agent enforced server-side? |
| AGT-06 | D | FAIL | No ledger proof at level D. Does delegation work: the Intelligence Layer assigns a sub-task to an agent, the agent works, returns a result, and the parent task shows... |
| AGT-07 | D | FAIL | No ledger proof at level D. Can multiple agents work in parallel on independent sub-tasks and combine results? Test with three. |
| AGT-08 | D | FAIL | No ledger proof at level D. How are conflicts and loops prevented (maximum steps, maximum depth, duplicate detection)? |
| AGT-09 | E | FAIL | No ledger proof at level E. Are agent definitions, runs and outputs persisted and visible across devices? |
| AGT-10 | C | FAIL | No ledger proof at level C. Can the person monitor a running agent (steps, tool calls, partial output) and stop it? |
| AGT-11 | F | FAIL | No ledger proof at level F. What happens when an agent's tool fails, its model is unavailable, or it exceeds budget? |
| AGT-12 | F | FAIL | No ledger proof at level F. Can a run resume after a disconnect without repeating side effects? |
| AGT-13 | G | FAIL | No ledger proof at level G. Cost and time per run are tracked and capped. |
| AGT-14 | H | FAIL | No ledger proof at level H. Can an agent be invoked from Chat (@mention), Eve (by name), Human Code, and a schedule? |
| AGT-15 | I | FAIL | No ledger proof at level I. Can an agent read or write anything its owner has not allowed? Test the boundary. |
| AGT-16 | J | FAIL | No ledger proof at level J. Evidence that no agent card shows a state that was not produced by a real run (no fake "running"). |
| MEM-01 | A | FAIL | No ledger proof at level A. What is memory in the implementation today: a setting, a table, a vector index, a prompt? Show it. |
| MEM-02 | D | FAIL | No ledger proof at level D. How are memories created: explicit ("remember this"), automatic extraction after conversations, or manual entry? Which exist? |
| MEM-03 | D | FAIL | No ledger proof at level D. How are memories retrieved for a request: keyword, semantic search, recency, project scope? Show the query and the ranking for a test. |
| MEM-04 | D | FAIL | No ledger proof at level D. Do retrieved memories measurably change answers? Run A/B tests with and without a planted fact. |
| MEM-05 | E | FAIL | No ledger proof at level E. Are memories stored per user, optionally per project, with source, time and confidence? |
| MEM-06 | C | FAIL | No ledger proof at level C. Can the person see, edit, delete, pin, disable and export memories? Does deletion remove it from retrieval immediately? |
| MEM-07 | C | FAIL | No ledger proof at level C. Is there a temporary mode that neither reads nor writes memory? |
| MEM-08 | F | FAIL | No ledger proof at level F. How are outdated or contradicted memories handled (supersede, ask, expire)? |
| MEM-09 | G | FAIL | No ledger proof at level G. Does retrieval stay fast and within token budget with 10,000 memories? |
| MEM-10 | H | FAIL | No ledger proof at level H. Do Chat, Eve, Human Code, Build (opt-in), Research and Agents each use memory appropriately? Show one test per module. |
| MEM-11 | I | FAIL | No ledger proof at level I. Are sensitive memories protected, never shown to other users, never sent to providers unnecessarily, and excluded from logs? |
| MEM-12 | I | FAIL | No ledger proof at level I. Can planted text in a web page or file become a stored memory (memory poisoning)? Test and block. |
| MEM-13 | C | FAIL | No ledger proof at level C. Is the knowledge base (files, notes, links the person added) separate from memory and searchable with citations? |
| MEM-14 | J | FAIL | No ledger proof at level J. Evidence that Memory influences real task execution, not just replies. |
| IGN-01 | A | FAIL | No ledger proof at level A. Is it real? What does it do today (read, write, send)? Which API and scopes? |
| IGN-02 | C | FAIL | No ledger proof at level C. Connection flow: does it use the provider's proper authorization (OAuth where supported), return to the right screen, and show success? |
| IGN-03 | D | FAIL | No ledger proof at level D. After connecting, does a real read succeed (list repos, list emails, list files, search pages)? Show it. |
| IGN-04 | D | FAIL | No ledger proof at level D. Does a real action succeed where actions are offered (create issue, create page, draft email), with approval? Show the outcome in the thi... |
| IGN-05 | C | FAIL | No ledger proof at level C. Is the permissions list accurate and plain? Are write and send scopes off by default? |
| IGN-06 | F | FAIL | No ledger proof at level F. Token expiry and revocation: does the app detect them, show "Reconnect", and recover without data loss? |
| IGN-07 | F | FAIL | No ledger proof at level F. Rate limits and provider outages: clear messages, backoff. |
| IGN-08 | C | FAIL | No ledger proof at level C. Disconnect: does it revoke at the provider where possible and delete stored tokens? Does the Intelligence Layer stop using it immediately? |
| IGN-09 | E | FAIL | No ledger proof at level E. Where are tokens stored (server, encrypted)? Can the browser ever read them? |
| IGN-10 | D | FAIL | No ledger proof at level D. Webhooks: are inbound events (new issue, new email) received, verified by signature, deduplicated and turned into notifications or tasks?... |
| IGN-11 | C | FAIL | No ledger proof at level C. Is there a per-integration activity log (what the product did, when) the person can read? |
| IGN-12 | H | FAIL | No ledger proof at level H. Do Chat, Eve, Agents, Build/Kimi (via MCP) and the Intelligence Layer use the integration through the capability contract with permission... |
| IGN-13 | I | FAIL | No ledger proof at level I. Least privilege: the narrowest scopes needed. List scopes now and justify each. |
| IGN-14 | C | FAIL | No ledger proof at level C. Dates and statuses human-formatted; no raw timestamps (BLUEPRINT 2, M18). |
| IGN-15 | C | FAIL | No ledger proof at level C. Resolve contradictions in status text (for example Gmail saying Connected and also not connected). |
| IGN-16 | C | FAIL | No ledger proof at level C. Is Notion on proper authorization or an API token, and is the token path clearly explained and safe? |
| IGN-17 | B | FAIL | No ledger proof at level B. The integrations page is organized: Connected, Available, Custom MCP; searchable; each card consistent. |
| IGN-18 | J | FAIL | No ledger proof at level J. One recorded end-to-end journey per live integration: connect, read, act, verify in the third party, disconnect (JOU-06). |
| IGN-19 | A | FAIL | No ledger proof at level A. Any payment or financial integration (if ever added) is out of scope until security review; do not add one without the owner's written ap... |
| PRV-01 | A | FAIL | No ledger proof at level A. List every provider and model shown. For each, prove it is callable now (a real request) or remove it. |
| PRV-02 | D | FAIL | No ledger proof at level D. Is the selected model the model used on every path (Chat, Research, Build, Voice, Agents, Human Code)? Show request logs with the model i... |
| PRV-03 | D | FAIL | No ledger proof at level D. Is there one model router with a written policy for Auto (BLUEPRINT 1, F3 in BLUEPRINT 2)? Is every routing decision logged with its reason? |
| PRV-04 | D | FAIL | No ledger proof at level D. Model discovery: how are available models listed and refreshed? What happens when a model is retired? |
| PRV-05 | C | FAIL | No ledger proof at level C. API key management: add, test, rotate, delete, last-4 display. Do keys ever reach the browser? |
| PRV-06 | D | FAIL | No ledger proof at level D. Streaming: supported per provider, normalized to one event format. |
| PRV-07 | F | FAIL | No ledger proof at level F. Fallbacks: when a provider fails, does failover choose the next one, tell the person, and avoid double billing? Failover default ON. |
| PRV-08 | G | FAIL | No ledger proof at level G. Quotas, rate limits and provider health: tracked, shown in a status view, with alerts. |
| PRV-09 | G | FAIL | No ledger proof at level G. Usage and cost per provider, model, feature and user. Is the arithmetic right (compare to provider invoices)? |
| PRV-10 | F | FAIL | No ledger proof at level F. Error handling per provider error class (auth, quota, rate, overloaded, content filter, invalid request). |
| PRV-11 | I | FAIL | No ledger proof at level I. Provider credentials separated by environment; no keys in the repository or logs. |
| PRV-12 | I | FAIL | No ledger proof at level I. Which data each provider receives; disclosure in Privacy. |
| PRV-13 | D | FAIL | No ledger proof at level D. Capability differences handled: which models support tools, images, long context, audio. Does the router avoid sending unsupported requests? |
| PRV-14 | J | FAIL | No ledger proof at level J. A provider test page ("Test") for each provider that performs a real round trip and records the result. |
| RSC-01 | A | FAIL | No ledger proof at level A. Is Research a real pipeline (plan, search, fetch, read, synthesize, cite) or one model call? Draw it. |
| RSC-02 | D | FAIL | No ledger proof at level D. Which search provider and fetcher are used, and is there a working default with no setup? |
| RSC-03 | D | FAIL | No ledger proof at level D. Does each citation correspond to a page actually fetched in this run? Build a checker that opens each cited URL record and confirms the q... |
| RSC-04 | D | FAIL | No ledger proof at level D. Are claims traceable: each sentence in the report maps to one or more sources? |
| RSC-05 | D | FAIL | No ledger proof at level D. Is fact verification implemented (cross-check important claims against a second source; mark uncertain ones)? |
| RSC-06 | C | FAIL | No ledger proof at level C. Depth controls (Quick, Standard, Deep) have real, measured differences in sources read and time spent. |
| RSC-07 | C | FAIL | No ledger proof at level C. Progress shown live with cancel; resumable after disconnect. |
| RSC-08 | E | FAIL | No ledger proof at level E. Reports saved with sources and run metadata; reopenable on any device. |
| RSC-09 | C | FAIL | No ledger proof at level C. Document analysis: upload a PDF or paper and ask questions with page citations. |
| RSC-10 | C | FAIL | No ledger proof at level C. Export: copy, Markdown, PDF, Word; saved into Library and Projects. |
| RSC-11 | H | FAIL | No ledger proof at level H. Can Chat, Eve, Agents and the Intelligence Layer start a research task and consume the result as structured data? |
| RSC-12 | F | FAIL | No ledger proof at level F. Partial failure: blocked pages, paywalls, timeouts; the report says what could not be read. |
| RSC-13 | I | FAIL | No ledger proof at level I. Prompt injection from fetched pages is neutralized; tool permissions do not widen because of page content. |
| RSC-14 | G | FAIL | No ledger proof at level G. Time and cost per depth level; per-source reading cost; token budgets. |
| RSC-15 | C | FAIL | No ledger proof at level C. Conflicting sources are shown with both positions. |
| RSC-16 | J | FAIL | No ledger proof at level J. Evidence that JOU-05 (research, save to project, create document, download file) passes. |
| FIL-01 | A | FAIL | No ledger proof at level A. List every supported file type for upload, preview, extraction and generation. Test each type with a real sample. |
| FIL-02 | D | FAIL | No ledger proof at level D. Storage: bucket structure, naming, size limits, signed URLs, retention. |
| FIL-03 | D | FAIL | No ledger proof at level D. Extraction: text from PDF (with OCR for scans), Word, Excel, slides, images (vision), audio (transcript), video (frames and transcript). ... |
| FIL-04 | C | FAIL | No ledger proof at level C. Preview: images, PDF, text, code, spreadsheets, audio, video on a phone. |
| FIL-05 | C | FAIL | No ledger proof at level C. Editing: text and code in place; documents through a proper editor or a regenerate flow. |
| FIL-06 | D | FAIL | No ledger proof at level D. Generated deliverables are REAL files: Word, Excel, PowerPoint, PDF, Markdown, CSV, code zip, images. Open each in its native app to conf... |
| FIL-07 | C | FAIL | No ledger proof at level C. Download and share: system share sheet, expiring links, revoke. |
| FIL-08 | E | FAIL | No ledger proof at level E. Everything produced appears in Library with source links; deleting removes storage. |
| FIL-09 | F | FAIL | No ledger proof at level F. Large uploads: resumable chunks; failure recovery; HEIC conversion; progress and cancel. |
| FIL-10 | G | FAIL | No ledger proof at level G. Upload throughput and time to "ready" per file type; virus and size safeguards. |
| FIL-11 | I | FAIL | No ledger proof at level I. Private by default; no public bucket listing; malware and type validation. |
| FIL-12 | H | FAIL | No ledger proof at level H. Files usable by Chat, Human Code, Build (copy into workspace), Research, Agents and Eve. |
| FIL-13 | C | FAIL | No ledger proof at level C. Image generation: provider, prompt controls, history, download, regenerate, safety refusals shown clearly. |
| FIL-14 | J | FAIL | No ledger proof at level J. Evidence for every file type's end-to-end behavior. |
| BRW-01 | A | FAIL | No ledger proof at level A. Does Browser use exist? What is the real mechanism (remote browser session, a driver, an extension, a paired computer)? If none, state "n... |
| BRW-02 | A | FAIL | No ledger proof at level A. The "Computer: Desktop control" and "Browser operator" entries: real or decorative? |
| BRW-03 | D | FAIL | No ledger proof at level D. Supported actions: open URL, click, type, scroll, select, upload and download files, screenshots, tabs, waiting, login persistence. Test ... |
| BRW-04 | C | FAIL | No ledger proof at level C. Does the person see what the browser sees (live view or screenshots) and can take over? |
| BRW-05 | C | FAIL | No ledger proof at level C. Is every action visible, interruptible and logged (what, where, screenshot)? |
| BRW-06 | F | FAIL | No ledger proof at level F. Handling of captchas, logins, popups, page changes, timeouts; stops and asks instead of guessing. |
| BRW-07 | I | FAIL | No ledger proof at level I. Allow-list and deny-list of domains; no entry of passwords unless the person provides them through a secure handoff; sensitive actions (p... |
| BRW-08 | I | FAIL | No ledger proof at level I. Isolation: separate profile per user, no shared cookies, no access to the app's own admin. |
| BRW-09 | I | FAIL | No ledger proof at level I. Prompt-injection defense on pages the browser reads. |
| BRW-10 | G | FAIL | No ledger proof at level G. Step latency and cost; session limits. |
| BRW-11 | H | FAIL | No ledger proof at level H. Usable by the Intelligence Layer, Agents and Kimi (via tool/MCP) through the capability contract. |
| BRW-12 | J | FAIL | No ledger proof at level J. Paired computer: pairing flow, test connection, scope of control, emergency disconnect; recorded proof. |
| SET-01 | A | FAIL | No ledger proof at level A. Make a table of every setting: location, control type, stored where, read by which code, effect. |
| SET-02 | D | FAIL | No ledger proof at level D. For each setting, the test that changes it and shows a real change in behavior. A setting with no effect is removed or implemented. |
| SET-03 | E | FAIL | No ledger proof at level E. Every setting persists to the account and syncs to other devices. |
| SET-04 | C | FAIL | No ledger proof at level C. Settings search works and lands on the right control. |
| SET-05 | C | FAIL | No ledger proof at level C. Appearance: Dark, Light, System and accent change every screen with no mixed colors. |
| SET-06 | C | FAIL | No ledger proof at level C. Provider failover, default models, effort defaults, web search default, voice, notifications, data controls: each verified. |
| SET-07 | I | FAIL | No ledger proof at level I. Dangerous settings (delete data, disconnect, emergency stop) confirm and are reversible where possible. |
| SET-08 | C | FAIL | No ledger proof at level C. "Emergency stop": exact effects listed and tested. |
| SET-09 | C | FAIL | No ledger proof at level C. Reset to defaults per section. |
| SET-10 | J | FAIL | No ledger proof at level J. Evidence screenshot or recording per setting group. |
| NTA-01 | A | FAIL | No ledger proof at level A. Event types that generate notifications today; create the full list (task finished or failed, approval needed, schedule result, integrati... |
| NTA-02 | D | FAIL | No ledger proof at level D. Delivery channels: in-app inbox, Home Screen push, email. Which work end to end on iPhone? Test each. |
| NTA-03 | C | FAIL | No ledger proof at level C. Preferences per event and channel; quiet hours; digest options. |
| NTA-04 | E | FAIL | No ledger proof at level E. Notification history, read state, and deep links that open the right screen. |
| NTA-05 | D | FAIL | No ledger proof at level D. Schedules: one-time, daily, weekly, monthly, custom, time zone and daylight saving correctness. Run a test across a time change. |
| NTA-06 | D | FAIL | No ledger proof at level D. Triggers: time, webhook (integration event), task completion, file arrival, inbox event. Which exist? Build the missing ones that matter. |
| NTA-07 | D | FAIL | No ledger proof at level D. Server-side execution with the app closed; show a scheduled task running overnight. |
| NTA-08 | F | FAIL | No ledger proof at level F. Retries with backoff; failure notification; no silent loss; no duplicate runs after a retry. |
| NTA-09 | C | FAIL | No ledger proof at level C. Cancel, pause, resume, edit and run-now; run history with results. |
| NTA-10 | G | FAIL | No ledger proof at level G. Scheduler accuracy (run within a minute of schedule) and load behavior with 500 schedules. |
| NTA-11 | I | FAIL | No ledger proof at level I. Automations obey permission policies; a schedule cannot do what the person did not allow. |
| NTA-12 | H | FAIL | No ledger proof at level H. The Intelligence Layer and Eve can create, list and change schedules by request, with receipts. |
| NTA-13 | J | FAIL | No ledger proof at level J. Evidence of a real overnight run with a notification received. |
| INF-01 | A | FAIL | No ledger proof at level A. Draw the real deployment diagram: hosting, functions, database, storage, queue, sandbox service, cron, third-party services. |
| INF-02 | D | FAIL | No ledger proof at level D. Authentication: provider, session handling, token refresh, logout everywhere, password and two-factor options, account recovery. |
| INF-03 | I | FAIL | No ledger proof at level I. Database: every table has row-level security; tests that attempt cross-user reads and writes fail. |
| INF-04 | D | FAIL | No ledger proof at level D. Migrations: versioned, reversible, run in CI; a staging database; no manual production edits. |
| INF-05 | D | FAIL | No ledger proof at level D. API contracts: typed, documented, validated; breaking-change policy. |
| INF-06 | D | FAIL | No ledger proof at level D. Background workers and queue: where they run, how they scale, how failures are seen. |
| INF-07 | D | FAIL | No ledger proof at level D. Environments: development, preview, production with separate keys; configuration documented. |
| INF-08 | G | FAIL | No ledger proof at level G. Monitoring: error tracking, logs with request ids, uptime checks, performance traces, cost dashboard, alerts to the owner. |
| INF-09 | F | FAIL | No ledger proof at level F. Backups: automated database and storage backups, retention, and a tested restore. |
| INF-10 | F | FAIL | No ledger proof at level F. Rollback: one step to previous deployment; database migrations safe to roll back or forward. |
| INF-11 | I | FAIL | No ledger proof at level I. Security headers, CSRF, CORS, rate limiting, input validation, dependency scanning, secret scanning. |
| INF-12 | I | FAIL | No ledger proof at level I. Rate limits and spend caps per user and global; kill switches per provider and module. |
| INF-13 | G | FAIL | No ledger proof at level G. Scalability: what breaks first at 10, 100 and 1,000 users? Load-test the chat route and the Build gateway. |
| INF-14 | F | FAIL | No ledger proof at level F. Long-running work does not depend on a single web request; timeouts documented. |
| INF-15 | J | FAIL | No ledger proof at level J. Production readiness checklist signed with evidence. |
| UIX-01 | A | FAIL | No ledger proof at level A. Inventory every screen, modal, sheet, panel, menu and state with a screenshot in Dark and Light. |
| UIX-02 | C | FAIL | No ledger proof at level C. A design system exists (tokens, components) and is used everywhere (BLUEPRINT 1, PART 7). |
| UIX-03 | C | FAIL | No ledger proof at level C. Visual defects list: mixed theme colors, faded buttons, overlapping layers, covered controls, unlabeled icons, clipped text, inconsistent... |
| UIX-04 | A | FAIL | No ledger proof at level A. Missing assets: app icon set, splash, favicon, Eve avatar states, integration logos (official), empty-state illustrations, onboarding ima... |
| UIX-05 | C | FAIL | No ledger proof at level C. Motion: transitions and animations are smooth (60 frames per second target on a recent iPhone), purposeful, and respect reduced motion. |
| UIX-06 | C | FAIL | No ledger proof at level C. Every loading, empty, error, success and offline state designed and implemented (BLUEPRINT 1, 8.1). |
| UIX-07 | C | FAIL | No ledger proof at level C. Navigation is clear: one drawer, one top bar, one composer; no feature has two entry points of the same type. |
| UIX-08 | C | FAIL | No ledger proof at level C. Copy: plain language, consistent tone, banned-term test passes. |
| UIX-09 | C | FAIL | No ledger proof at level C. Typography and iconography are consistent; icons have labels. |
| UIX-10 | C | FAIL | No ledger proof at level C. Accessibility: contrast, focus, screen reader, text scaling, hit sizes, keyboard navigation on desktop. |
| UIX-11 | C | FAIL | No ledger proof at level C. First-run experience: onboarding that gets a new person to a successful first message and shows the main modules. |
| UIX-12 | J | FAIL | No ledger proof at level J. Side-by-side comparison with the reference apps for structure and polish; list remaining gaps. |
| MOB-01 | C | FAIL | No ledger proof at level C. Test matrix: iPhone small, standard, large; iPad; Android phone; desktop Safari, Chrome, Edge, Firefox; Home Screen app and browser tab. |
| MOB-02 | C | FAIL | No ledger proof at level C. Keyboard: opening and closing never hides the composer, voice controls or primary buttons; no layout jumps. |
| MOB-03 | C | FAIL | No ledger proof at level C. Safe areas, notch, home indicator, dynamic toolbars; no horizontal scroll. |
| MOB-04 | C | FAIL | No ledger proof at level C. Touch targets; gestures; long press menus; pull to refresh where intended. |
| MOB-05 | C | FAIL | No ledger proof at level C. Desktop: persistent sidebar, multi-pane Build, keyboard shortcuts, hover states, window resizing. |
| MOB-06 | F | FAIL | No ledger proof at level F. Offline and flaky network behavior; resume after the app is suspended. |
| MOB-07 | G | FAIL | No ledger proof at level G. Performance on a mid-range phone: load time, interaction latency, scroll smoothness, memory. |
| MOB-08 | C | FAIL | No ledger proof at level C. Installability: manifest, icons, standalone display, update prompts; push notifications in the installed app. |
| MOB-09 | J | FAIL | No ledger proof at level J. A responsive screenshot is NOT proof of function: every journey (JOU-01 to JOU-12) is run on a phone and on desktop with recordings. |
| INV-01 | J | FAIL | No ledger proof at level J. Total elements found, total verified PASS, total removed, total fixed. Report these numbers. |
| INV-02 | J | FAIL | No ledger proof at level J. Zero rows may remain with status NOT TESTED or FAIL at the final gate. |

## Blueprint 93

| Proof | Status | Missing evidence |
| --- | --- | --- |
| Full inspect, click, screenshot, verify, repair, and regression pass | FAIL | No completed audit loop. |
| Second independent review | FAIL | Not run. |

## Blueprint 94

| Proof | Status | Missing evidence |
| --- | --- | --- |
| Custom MCP add, authenticate, discover, and invoke | FAIL | Foundation exists. The owner flow is not proven end to end. |
| Official logos checked against the reference recording | FAIL | Not re-verified. |
| Production acceptance of one commit | FAIL | Not deployed. Waiting for the owner's merge-and-deploy approval, and the product is not ready for that approval. |

## Waiting only on the production approval

The Notion page ID and Stage 0 phrase are not blocking local work. The installer exists. It is not installed, and Windows has not granted the PC permissions. Do not merge or deploy until the owner approves that step and the FAIL rows above that require production have a real production test.
