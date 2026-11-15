# Blockers for Issue 48 and Blueprint 92

Every row is still FAIL. A local group means the proof can be attempted on this preview. It does not mean the question is closed. This is not a PASS ledger. The permanent website stays blocked until the product is finished.

## Issue 48

### production-deploy (5)

- FAIL. Every typecheck, script test, unit test shard, build, static audit and migration test passes on exact deployment SHA.
- FAIL. Production Postgres migrations 0006 and 0007 are applied, with safety/backup verification; no forbidden DB identifier.
- FAIL. User secrets encrypted and never exposed in browser or logs.
- FAIL. Persistent credentials and sessions survive restart, auth callback and deployment.
- FAIL. Browser smoke tests: auth, navigation, responsive UI, browser console, all API error states.

### paid-or-host (5)

- FAIL. Provision approved always-on Node.js >=24.11 host (no purchase without approval).
- FAIL. Verify pinned Paperclip package and authenticated service health.
- FAIL. Configure separate durable database, backups and budget controls.
- FAIL. Connect GitHub read-only, run exactly one authenticated Codebase Auditor agent.
- FAIL. Confirm actual job execution/reporting, task status, errors and spending.

### owner-oauth-or-credentials (3)

- FAIL. Custom model API connection: key save, discovery, selection, chat, text+tools/vision capability handling.
- FAIL. OpenAI, xAI, Gemini, Anthropic, OpenRouter adapters; normalize streaming, error and history.
- FAIL. Gmail, Drive, Calendar, GitHub, Notion, Slack, YouTube authorisations and operations.

### owner-notion (1)

- FAIL. Hydrate genuine Notion graph data and Paperclip runtime telemetry; distinguish unavailable sources.

### local-preview (11)

- FAIL. Add authenticated server-only status/task adapter to Adrian's Mind.
- FAIL. Map Paperclip agent/heartbeat/run data onto 3D graph and Runs/Tasks screens.
- FAIL. Grant code-write or production permissions only with explicit approved policy.
- FAIL. MCP URL connect, OAuth/bearer, transport/session negotiation, tools/list, schema args, tools/call.
- FAIL. AI tool broker: natural-language tool selection, per-write approvals, audit events, tool results returned to model.
- FAIL. Fix Speak regression; verify xAI Eve TTS, STT, realtime speech, mute, interrupt and selected-voice identity.
- FAIL. Create original waist-up adult female avatar with eye contact, idle/listen/think/speak/error states and lip-sync.
- FAIL. Verify Graph/Universe switch, WebGL fallback, search, node select, zoom, mobile Safari.
- FAIL. Implement/reuse supervised background worker with queue, retries, schedules, cancellation and recovery.
- FAIL. Verify project/file/memory/history tools, actions and persistence.
- FAIL. Verify every UI control with browser action, authenticated backend result, persistence and accurate feedback.

## Blueprint 92

359 questions.

### local-preview (348)

- INT-01 [A] FAIL. Does an Intelligence Layer exist as server code today? Name the files, routes and services. If only a model selector exists, say so.
- INT-02 [A] FAIL. Is there a written definition of the Intelligence Layer's responsibilities that matches B1 and B2? Is it in the repository docs?
- INT-03 [B] FAIL. How does a person reach it? (Every surface routes into it: Chat, Eve, Human Code, Quick bar.) Is there a quick bar reachable from every screen?
- INT-04 [C] FAIL. When the person types or says "create a project called Marina, add three tasks, and ask the research agent to find zoning rules", what exact sequence of internal steps happens? ...
- INT-05 [D] FAIL. Is there a capability registry? List every capability, its input schema, output schema, permission class and side effects.
- INT-06 [D] FAIL. Does every module register its capabilities (Projects, Agents, Build, Research, Files, Integrations, Memory, Scheduled, Notifications, Browser)?
- INT-07 [D] FAIL. Does the planner produce a visible plan before side-effecting work starts? Where is it stored?
- INT-08 [D] FAIL. Can the planner choose between capabilities correctly? Provide 30 test requests with expected capability sequences and the measured accuracy.
- INT-09 [D] FAIL. Which model runs the planner, and what is the fallback when it fails or returns an invalid plan?
- INT-10 [D] FAIL. How are capability inputs validated before execution? What happens on invalid input?
- INT-11 [E] FAIL. Is there a durable task record for every request that does work (id, owner, project, status, steps, inputs, outputs, errors, cost, timestamps)? Show the table.
- INT-12 [E] FAIL. Can a task be reopened after a refresh, a new session and a different device, and show the same state?
- INT-13 [E] FAIL. Are action receipts stored permanently and linked from the conversation?
- INT-14 [C] FAIL. Does the reply visibly distinguish PROPOSED, EXECUTED and FAILED actions? Show all three states.
- INT-15 [J] FAIL. Can the model ever say "done" without a receipt? Write a test that tries to make it claim an action it did not take, and prove the composer blocks it.
- INT-16 [C] FAIL. What is the permission policy per capability class (read, write, spend, send, delete)? Is it editable by the owner in Settings?
- INT-17 [C] FAIL. Is the approval flow usable on a phone, including when the app is in the background (notification, then approve)?
- INT-18 [D] FAIL. Can the Intelligence Layer delegate to an Agent, to Build/Kimi, to Research and to the Browser, wait for each result and combine them?
- INT-19 [D] FAIL. Does delegation create child task records with parent links, and can the person see the tree?
- INT-20 [D] FAIL. Can it run steps in parallel when they are independent, and serialize when they depend?
- INT-21 [F] FAIL. If one step fails, does it retry, skip, ask the person, or abort? Is the policy per capability and visible?
- INT-22 [F] FAIL. If the connection drops mid-task, does the task continue on the server and reattach when the person returns without re-running steps?
- INT-23 [F] FAIL. Are all side-effecting steps idempotent (an idempotency key per step), so a retry never creates a second project, second email or second charge?
- INT-24 [F] FAIL. What happens when two requests that touch the same project arrive at once? Is there locking or ordering?
- INT-25 [G] FAIL. What is the time from request to first visible plan? To first receipt? Provide baseline and after measurements.
- INT-26 [H] FAIL. Does the Intelligence Layer load the right memory, project and conversation context for each step, and only that (no cross-project leakage)? Prove with a test using two projects...
- INT-27 [H] FAIL. Can Eve, Chat, Human Code and Agents all invoke the same capabilities through the same path? Show one request made from each surface producing the same receipt.
- INT-28 [I] FAIL. Can the Intelligence Layer be tricked by text inside a web page, a file or an email into executing a forbidden action (prompt injection)? Write at least ten attack tests and sho...
- INT-29 [I] FAIL. Does it respect the per-user permission policy and never act with another user's credentials?
- INT-30 [I] FAIL. Is every capability call written to the Activity log with who, what, inputs (redacted), result and time?
- INT-31 [G] FAIL. What is the cost per request class, and does the layer enforce budgets and stop politely when one is reached?
- INT-32 [C] FAIL. Can the person interrupt a running task ("stop", "change the plan", "skip step 3") and have the layer obey?
- INT-33 [C] FAIL. Can the person ask "what are you doing right now?" and get a truthful answer from the task ledger, not from model imagination?
- INT-34 [C] FAIL. Can the person ask "what did you do yesterday?" and get answers from receipts?
- INT-35 [J] FAIL. What end-to-end test proves JOU-04 (the project and agents journey) passes, and at what level of proof (E3)?
- EVE-01 [A] FAIL. Where is Eve in the app today? Is she a separate module or only a voice screen with an orb? Document honestly.
- EVE-02 [B] FAIL. How does the person open Eve: from the mode switch, a floating button, a wake action, a lock-screen shortcut, the Home Screen app icon? Which ones exist?
- EVE-03 [A] FAIL. Is there an avatar? Is it photoreal? Is it a generated or licensed asset? Is the asset register filled in (source, license, date)?
- EVE-04 [A] FAIL. Does the avatar have meaningful states: idle, listening, thinking, speaking, interrupted, happy, concerned, curious, sleepy? List which exist and show each.
- EVE-05 [C] FAIL. Do state changes happen at the right moments and match the true conversation state (BLUEPRINT 2, D1)? Is there a debug overlay showing the current state for testing?
- EVE-06 [D] FAIL. Is the mouth animation driven by the actual speech audio (visemes or audio level), or is it a canned loop? Measure the sync error in milliseconds.
- EVE-07 [G] FAIL. What frame rate does the avatar achieve on a mid-range iPhone, and what is its battery and heat impact over a 10-minute conversation?
- EVE-08 [F] FAIL. What does the avatar show when audio is blocked, the network is lost, or the model fails? (No frozen "speaking" state.)
- EVE-09 [D] FAIL. Does Eve listen hands-free, detect the end of a turn, and allow interruption? Measure barge-in stop time.
- EVE-10 [E] FAIL. Does Eve remember conversational context across a call, across calls, and across Chat and Human Code? Prove with a test.
- EVE-11 [H] FAIL. Is Eve's brain the Intelligence Layer? Can she start a research task, create a project, check a Build task, add a note, by voice, and speak receipts back?
- EVE-12 [H] FAIL. Can Eve hand a long result to the screen ("I've put that on screen") and reference it later?
- EVE-13 [C] FAIL. Can the owner configure Eve's voice, speaking speed, personality style, name for the person, language and quiet hours? Do the settings change real behavior, shown by tests?
- EVE-14 [C] FAIL. Does Eve have a consistent personality across sessions? Where is the personality defined (a versioned prompt), and is there an eval set that checks tone?
- EVE-15 [I] FAIL. Does Eve avoid claiming to be human or to have feelings she cannot have, when sincerely asked? Write tests.
- EVE-16 [I] FAIL. Does Eve avoid manipulative engagement tactics (guilt, pressure, jealousy, exclusivity)? Write tests.
- EVE-17 [I] FAIL. If a person expresses distress or crisis, does Eve respond with care and point to real-world help, not act as a replacement? Write tests and keep the policy visible in Settings ...
- EVE-18 [I] FAIL. Is Eve clearly labeled as an AI in the interface?
- EVE-19 [I] FAIL. Are voice recordings and transcripts stored only as the person allowed? Is there a visible recording indicator?
- EVE-20 [F] FAIL. What happens after 30 minutes of continuous conversation: memory, battery, audio drift, reconnection?
- EVE-21 [F] FAIL. What happens if the phone locks, a call arrives, headphones disconnect, or Bluetooth switches?
- EVE-22 [B] FAIL. Does Eve work in the Safari tab and the Home Screen app? Which features differ?
- EVE-23 [C] FAIL. Do Camera, Upload, Record and Screen buttons each do something real, with Eve describing what she sees? Test with a photo and a screenshot.
- EVE-25 [J] FAIL. What recorded test proves JOU-02 passes?
- CHT-01 [A] FAIL. What are the chat routes (page, API, streaming) and which files implement them? Draw the real request path from the Send button to the model and back.
- CHT-02 [C] FAIL. What happens on Enter, on Shift+Enter, on the Send button, on a long paste, on an empty message, on a message with only whitespace, on an extremely long message?
- CHT-03 [D] FAIL. Does the frontend send the correct payload (conversation id, model, project, attachments, idempotency key)? Show a captured request.
- CHT-04 [D] FAIL. Does the server verify identity, resolve the model from the selector, call the correct provider, and stream the result? Show server logs for one message.
- CHT-05 [D] FAIL. Is the model that the person selected the model that actually answered? Prove by asking each model to identify itself and by checking provider-side logs or response metadata.
- CHT-07 [C] FAIL. Does Stop cancel the stream on the server (no further tokens, no further cost) and leave a consistent saved message?
- CHT-08 [C] FAIL. Do Retry, Regenerate, Edit and Branch each work and preserve history correctly?
- CHT-09 [C] FAIL. Does the model selector list only models that work, show provider status, and handle a model that disappears?
- CHT-10 [E] FAIL. Does a conversation persist across refresh, new session, another device and after the browser data is cleared?
- CHT-11 [E] FAIL. Are conversations stored per user and per project, and never mixed? Test with two accounts and two projects.
- CHT-12 [E] FAIL. Are titles auto-generated and renamable; are pin, archive and delete real and complete?
- CHT-13 [C] FAIL. Do attachments (photo, camera, PDF, text, spreadsheet, audio) upload, show progress, get processed and get used in the answer? List each type and the result.
- CHT-14 [F] FAIL. What does the person see for each failure: no network, provider 401, 429, 500, timeout, content refused, oversized message, expired session? Is there Retry for each?
- CHT-15 [F] FAIL. If the app closes mid-reply, is the partial reply kept, and can the person continue it?
- CHT-16 [G] FAIL. Time from tap Send to first token on Wi-Fi and 5G; the distribution over 50 messages. Where is the latency (client, edge, database write, provider)?
- CHT-17 [G] FAIL. Are there unnecessary requests or re-renders during streaming? Measure renders per token and main-thread blocking.
- CHT-18 [G] FAIL. Memory use after a 500-message conversation. Is the list virtualized?
- CHT-19 [C] FAIL. Does markdown, code, tables, math and long links render correctly, with a working Copy on code blocks?
- CHT-20 [H] FAIL. Can the Intelligence Layer be invoked from Chat? Does a Chat message like "start a research on X" produce a task, a receipt and a link?
- CHT-21 [H] FAIL. Can Chat hand code questions to Human Code and tasks to Build, with context?
- CHT-22 [H] FAIL. Can results from Research, Build and Agents be inserted into the chat as cards that open the source?
- CHT-23 [I] FAIL. Can one user read another user's conversations by changing an id in a request? Test it.
- CHT-24 [I] FAIL. Are attachments stored privately with signed, expiring links?
- CHT-25 [C] FAIL. Does the effort control (Fast, Expert, Heavy, Auto) change model, token budget and tools? Show the mapping and prove each differs.
- CHT-26 [C] FAIL. Do temporary chats really save nothing?
- CHT-27 [C] FAIL. Does search over chat history work, including inside long conversations?
- CHT-28 [J] FAIL. What recorded test proves JOU-01 passes, at what level of proof?
- HUC-01 [A] FAIL. Does Human Code exist? Where? If not, specify and build it as a coding-focused conversation surface with its own thread list.
- HUC-02 [B] FAIL. How does the person open it, and how does it differ from Chat in layout, purpose and defaults?
- HUC-03 [C] FAIL. Does it have its own conversation history, separate from ordinary Chat, resumable by project and by repository?
- HUC-04 [D] FAIL. Does it know the current project: file tree, open files, recent changes, branch, failing tests? How is that context gathered and bounded?
- HUC-05 [D] FAIL. Can it read specific files and show them with syntax highlighting and line references?
- HUC-06 [D] FAIL. Can it explain, review, debug and propose changes with exact file and line references? Provide ten test tasks on a real repository and grade the answers.
- HUC-07 [D] FAIL. Can it hand a task to Build with the context attached (files, conversation summary, constraints), and show the Build task inside the Human Code thread?
- HUC-08 [D] FAIL. Can it report Build results back into the thread (summary, diffs, test results) and discuss them?
- HUC-09 [E] FAIL. Does the coding context persist across sessions and devices (open threads, last files, pending tasks)?
- HUC-10 [E] FAIL. Can the person continue a previous coding conversation weeks later with the right repository state, noting where the code has since changed?
- HUC-11 [D] FAIL. Which model does it use, and does it use the coding-appropriate model and tools (Kimi through Build for execution, a reasoning model for discussion)? Where is that configured?
- HUC-12 [C] FAIL. Does it support slash commands and quick actions: /explain, /review, /fix, /test, /refactor, /plan, /run, /diff, each with real behavior?
- HUC-13 [C] FAIL. Can the person attach screenshots of errors or logs and get useful analysis?
- HUC-14 [C] FAIL. Can the person select a code range and ask about it (long press, then Ask)?
- HUC-15 [F] FAIL. What happens when the repository is large, the context overflows, or a file cannot be read?
- HUC-16 [F] FAIL. What happens when Build is unavailable (sandbox down, Kimi key invalid)? Does Human Code say so plainly and offer discussion-only mode?
- HUC-17 [G] FAIL. Time to answer a question about a 200-file repository; how is the repository indexed and cached? Measure.
- HUC-18 [H] FAIL. Can Eve and the Intelligence Layer open or resume Human Code threads ("continue the login bug discussion")?
- HUC-19 [I] FAIL. Does it avoid exposing secrets from .env files and avoid sending them to providers?
- HUC-20 [I] FAIL. Does it respect the repository permissions of the connected GitHub account?
- HUC-21 [C] FAIL. Does the mobile layout allow reading code comfortably (horizontal scroll, wrap toggle, font size, pinch zoom)?
- HUC-22 [J] FAIL. What recorded test proves JOU-03 passes?
- BLD-01 [A] FAIL. Which file(s) implement Build today? Report the structure and size of `components/mind/build-workspace.tsx`, its imports and its state.
- BLD-02 [A] FAIL. For each of Editor, Terminal, Browser and Capabilities: what handler runs when it is tapped, and what does it do? If nothing, fix it.
- BLD-03 [B] FAIL. Can the person reach Build from the drawer, the mode pill, Human Code, Chat and a direct link? Does a deep link open the right workspace and session?
- BLD-04 [C] FAIL. Can the person create, select, rename, archive and delete workspaces and sessions? Do they persist?
- BLD-05 [D] FAIL. Where does code run? Name the sandbox technology, region, limits and cost per hour. Show a command executing in it.
- BLD-06 [D] FAIL. Is the working directory a persistent volume or repository checkout? What survives a restart?
- BLD-07 [C] FAIL. Is there a file explorer with create, rename, move, delete, upload, download and search? Test each.
- BLD-08 [C] FAIL. Is there an editor with syntax highlighting, search, undo, multi-file tabs and a phone-friendly key row? Test typing on iPhone.
- BLD-09 [C] FAIL. Is there a diff viewer with approve, reject, approve-all and per-hunk actions?
- BLD-10 [C] FAIL. Is there a terminal with live output, history, stop, and clear? Does it handle long output without freezing the phone?
- BLD-11 [C] FAIL. Is there a preview pane that shows the running app and refreshes after changes?
- BLD-12 [C] FAIL. Is there a Git tab (status, diff, stage, commit, branch, push, pull request) using the owner's connected GitHub?
- BLD-13 [C] FAIL. Are permission requests shown, answered and enforced? Prove a denied command does not run.
- BLD-14 [C] FAIL. Does cancellation stop the running process and the model call, and leave the workspace consistent?
- BLD-15 [F] FAIL. What happens when the sandbox crashes, runs out of disk, times out, or loses network? Does the person get a clear message and a one-tap recovery?
- BLD-16 [F] FAIL. What happens when the phone disconnects mid-task and returns an hour later? Does the sequence-numbered replay restore everything?
- BLD-17 [E] FAIL. Are tasks, steps, events, diffs and outputs stored and visible on another device?
- BLD-18 [G] FAIL. Cold start time, time to first token from the coding model, time to first file change, and terminal latency. Baseline and after.
- BLD-19 [G] FAIL. Does the Build screen stay responsive when a task prints thousands of lines or edits hundreds of files?
- BLD-20 [H] FAIL. Does Build use the owner's plugins and MCP servers, project instructions and Library? Show one task using each.
- BLD-21 [H] FAIL. Can the Intelligence Layer, Human Code, Eve (by voice) and Agents create Build tasks and read results through the capability contract?
- BLD-22 [I] FAIL. Is the sandbox isolated from the app's database, secrets and other users? Run an escape-attempt test suite.
- BLD-23 [I] FAIL. Is outbound network restricted, and are blocked domains reported?
- BLD-24 [I] FAIL. Are secrets masked in the UI and logs?
- BLD-25 [C] FAIL. Does the test runner button detect and run the project's tests and show results in a readable summary?
- BLD-26 [J] FAIL. What recorded test proves JOU-03 end to end (Human Code to Build to Kimi to diff to tests to result)?
- BLD-27 [C] FAIL. Is the old planner form removed or demoted so there is a single clear path (workspace, task, plan, approve, result)?
- KIM-01 [A] FAIL. Which upstream project and version is used (repository, tag or commit, license)? Is it the real Kimi Code CLI or a re-implementation or a wrapper around an API call?
- KIM-02 [A] FAIL. Where is it installed (sandbox image, package manager, pinned version)? Show the build recipe and the version command output from inside a running sandbox.
- KIM-03 [D] FAIL. Which integration method is implemented: ACP, Wire, print mode, web mode, or raw terminal text? State why this one, and what the others lack.
- KIM-04 [D] FAIL. Does the real process launch on demand, with the right working directory, environment and configuration, in under the cold-start budget (BLUEPRINT 2, B10)?
- KIM-05 [D] FAIL. Do sessions work: create, send prompt, receive streamed events, resume, list, delete? Show event logs for each.
- KIM-06 [D] FAIL. Do prompts reach the Kimi model with the owner's key and the chosen model? Show provider-side usage for a test prompt.
- KIM-07 [D] FAIL. Do all event types map to UI elements (BLUEPRINT 2, B5)? List every event type observed in real logs, and the element that renders it. Which are unhandled?
- KIM-08 [D] FAIL. Do file operations work: read, write, edit, create, delete, search? Show diffs for each.
- KIM-09 [D] FAIL. Do terminal operations work: run command, stream output, exit codes, long-running processes, stopping them?
- KIM-10 [D] FAIL. Do permission requests arrive as events, reach the phone, and does the answer (deny, once, always) reach Kimi and change behavior?
- KIM-11 [D] FAIL. Does cancellation stop Kimi's current turn, any running child process and any in-flight model call?
- KIM-12 [D] FAIL. Do slash commands, plan mode, todo lists, compaction, sub-agents, skills, plugins and MCP servers work through the integration? Fill the parity table (BLUEPRINT 2, B6): FEATURE,...
- KIM-13 [D] FAIL. Is auto-approve (YOLO) off by default, clearly labeled when on, and scoped to one session?
- KIM-14 [E] FAIL. Where do Kimi sessions, history and configuration live? Do they survive sandbox restarts and redeployments?
- KIM-15 [E] FAIL. Is the project instruction file Kimi creates (via its init command) visible and editable, and is it versioned in the repository?
- KIM-16 [F] FAIL. What happens when the Kimi key is invalid, expired, out of quota, or rate limited? Is the error specific and the next step clear?
- KIM-17 [F] FAIL. What happens if the upstream version changes its event format? Is there a contract test that fails loudly in staging before production is updated?
- KIM-18 [F] FAIL. What happens when Kimi hangs, loops, or exceeds the task budget? Is there a watchdog with a visible stop reason?
- KIM-19 [G] FAIL. Latency from prompt to first streamed event; events per second the UI can render without jank; memory of the sandbox process after an hour.
- KIM-20 [H] FAIL. Does Kimi inside Build use Adrian's connected MCP servers (GitHub, Notion), project instructions and the Library? Show one task for each.
- KIM-21 [I] FAIL. Is the Kimi key injected only for the session and masked everywhere? Search logs and the browser for it.
- KIM-22 [I] FAIL. Is the upstream license complied with (notices, attribution, trademark use)? Where is the open-source notices page?
- KIM-23 [I] FAIL. Does the owner have a clear disclosure about code leaving to Moonshot's servers, with a per-workspace option to use another provider? (BLUEPRINT 2, B14)
- KIM-24 [J] FAIL. Which capabilities are NOT supported or incorrectly represented in Adrian's Mind today? Produce the list and the plan to close each.
- KIM-25 [J] FAIL. Is there a scripted acceptance run (KC-1 to KC-18 in BLUEPRINT 2) that can be re-run after any Kimi update?
- SPK-01 [A] FAIL. Draw the real voice pipeline as implemented: microphone, capture, transcription, model, speech synthesis, playback. Which provider and endpoint at each stage?
- SPK-02 [G] FAIL. MEASURE the lag the owner feels. Instrument and record, over 50 turns, each segment: tap to mic ready, end of speech to transcript, transcript to first model token, first token ...
- SPK-03 [G] FAIL. Is the transcript waited for in full, or streamed while the person speaks? Is the model reply waited for in full before synthesis, or sent sentence by sentence?
- SPK-04 [G] FAIL. Is a new connection created each turn (TLS, WebSocket) or is one kept open? Is the audio element or context created once?
- SPK-05 [G] FAIL. Are audio formats and chunk sizes chosen for low latency on iPhone? Test alternatives and keep the fastest that works.
- SPK-06 [C] FAIL. Does the person need to press anything between turns? List every required press. Remove all that are not essential (hands-free loop).
- SPK-07 [C] FAIL. Does end-of-turn detection cut people off or wait too long? Test with fast talkers, slow talkers, pauses mid-sentence and background noise. Tune and record thresholds.
- SPK-08 [C] FAIL. Does barge-in work, with a stop under 500 ms and honest history?
- SPK-09 [D] FAIL. Is microphone readiness handled: permission state check, pre-prompt, recovery page, device change?
- SPK-10 [D] FAIL. Does playback start from an unlocked audio object on iPhone Safari every time, including after the screen sleeps?
- SPK-11 [E] FAIL. Are transcripts saved with timing and linked to the conversation? Can they be searched?
- SPK-12 [F] FAIL. What happens on network loss mid-turn, a stalled synthesis request, a provider error, a mic that stops providing audio? Is there a spoken or visual recovery?
- SPK-13 [F] FAIL. Are resources cleaned up (streams, audio nodes, sockets, timers) after a call ends or the page closes? Check for leaks after 20 calls.
- SPK-14 [G] FAIL. Does a 30-minute call stay smooth: memory, CPU, audio drift, battery?
- SPK-15 [C] FAIL. Do voice selection, personality, speed, activation mode and "My words" each change real behavior?
- SPK-16 [C] FAIL. Is dictation for text fields separate from calls, resilient to pauses and long speech, and accurate for the owner's vocabulary?
- SPK-17 [J] FAIL. Targets: first sound under 1.5 s typical; barge-in stop under 0.5 s; no required presses between turns. Show before and after measurements for each.
- PRJ-01 [A] FAIL. What is a project in the data model? Fields, relations to conversations, files, tasks, agents, memory, Build workspaces, schedules and integrations.
- PRJ-02 [C] FAIL. Create, rename, archive, restore, duplicate, delete a project. Does each propagate to children correctly?
- PRJ-03 [C] FAIL. Does the person have a clear way to switch the active project, and does every module show which project it is acting in?
- PRJ-04 [D] FAIL. Does each module use the active project's context only? Prove no leakage between two projects with similar content.
- PRJ-05 [E] FAIL. Do project files, instructions, conversations and tasks persist and sync across devices?
- PRJ-06 [C] FAIL. Are there project-level tasks with status, owner (person or agent), due date, and links to receipts?
- PRJ-07 [C] FAIL. Is there a project activity timeline (who or what did what, when)?
- PRJ-08 [H] FAIL. Can the Intelligence Layer create projects, tasks and notes and later report their state accurately?
- PRJ-09 [H] FAIL. Can Build, Research, Agents and Eve save outputs into the project and open them from it?
- PRJ-10 [C] FAIL. Is collaboration scoped (single owner now) and are sharing and roles defined for the future? Document the decision.
- PRJ-11 [F] FAIL. What happens when a project with running tasks is archived or deleted?
- PRJ-12 [I] FAIL. Are project permissions enforced server-side?
- PRJ-13 [G] FAIL. Does a project with 1,000 items stay fast (pagination, indexes)?
- PRJ-14 [C] FAIL. Can a project be exported (files, conversations, tasks) and imported?
- PRJ-15 [J] FAIL. The two dead "external product" cards (Oak Bridge Capital, BridgePoint): what are they, and are they now working links or removed?
- AGT-01 [A] FAIL. Which agents genuinely execute work today? List each template and prove one real run per agent (not a text reply).
- AGT-02 [A] FAIL. Every "NOT LIVE" template: implement, or remove.
- AGT-03 [C] FAIL. Create, edit, duplicate, delete an agent. Do changes affect the next run?
- AGT-04 [D] FAIL. What does an agent run consist of: model, instructions, tools, knowledge, limits? Show the run record.
- AGT-05 [D] FAIL. Which tools can agents call (the capability registry), and are tool permissions per agent enforced server-side?
- AGT-06 [D] FAIL. Does delegation work: the Intelligence Layer assigns a sub-task to an agent, the agent works, returns a result, and the parent task shows the child?
- AGT-07 [D] FAIL. Can multiple agents work in parallel on independent sub-tasks and combine results? Test with three.
- AGT-08 [D] FAIL. How are conflicts and loops prevented (maximum steps, maximum depth, duplicate detection)?
- AGT-09 [E] FAIL. Are agent definitions, runs and outputs persisted and visible across devices?
- AGT-10 [C] FAIL. Can the person monitor a running agent (steps, tool calls, partial output) and stop it?
- AGT-11 [F] FAIL. What happens when an agent's tool fails, its model is unavailable, or it exceeds budget?
- AGT-12 [F] FAIL. Can a run resume after a disconnect without repeating side effects?
- AGT-13 [G] FAIL. Cost and time per run are tracked and capped.
- AGT-14 [H] FAIL. Can an agent be invoked from Chat (@mention), Eve (by name), Human Code, and a schedule?
- AGT-15 [I] FAIL. Can an agent read or write anything its owner has not allowed? Test the boundary.
- AGT-16 [J] FAIL. Evidence that no agent card shows a state that was not produced by a real run (no fake "running").
- MEM-01 [A] FAIL. What is memory in the implementation today: a setting, a table, a vector index, a prompt? Show it.
- MEM-02 [D] FAIL. How are memories created: explicit ("remember this"), automatic extraction after conversations, or manual entry? Which exist?
- MEM-03 [D] FAIL. How are memories retrieved for a request: keyword, semantic search, recency, project scope? Show the query and the ranking for a test.
- MEM-04 [D] FAIL. Do retrieved memories measurably change answers? Run A/B tests with and without a planted fact.
- MEM-05 [E] FAIL. Are memories stored per user, optionally per project, with source, time and confidence?
- MEM-06 [C] FAIL. Can the person see, edit, delete, pin, disable and export memories? Does deletion remove it from retrieval immediately?
- MEM-07 [C] FAIL. Is there a temporary mode that neither reads nor writes memory?
- MEM-08 [F] FAIL. How are outdated or contradicted memories handled (supersede, ask, expire)?
- MEM-09 [G] FAIL. Does retrieval stay fast and within token budget with 10,000 memories?
- MEM-10 [H] FAIL. Do Chat, Eve, Human Code, Build (opt-in), Research and Agents each use memory appropriately? Show one test per module.
- MEM-11 [I] FAIL. Are sensitive memories protected, never shown to other users, never sent to providers unnecessarily, and excluded from logs?
- MEM-12 [I] FAIL. Can planted text in a web page or file become a stored memory (memory poisoning)? Test and block.
- MEM-13 [C] FAIL. Is the knowledge base (files, notes, links the person added) separate from memory and searchable with citations?
- MEM-14 [J] FAIL. Evidence that Memory influences real task execution, not just replies.
- IGN-01 [A] FAIL. Is it real? What does it do today (read, write, send)? Which API and scopes?
- IGN-02 [C] FAIL. Connection flow: does it use the provider's proper authorization (OAuth where supported), return to the right screen, and show success?
- IGN-03 [D] FAIL. After connecting, does a real read succeed (list repos, list emails, list files, search pages)? Show it.
- IGN-04 [D] FAIL. Does a real action succeed where actions are offered (create issue, create page, draft email), with approval? Show the outcome in the third-party service.
- IGN-05 [C] FAIL. Is the permissions list accurate and plain? Are write and send scopes off by default?
- IGN-06 [F] FAIL. Token expiry and revocation: does the app detect them, show "Reconnect", and recover without data loss?
- IGN-07 [F] FAIL. Rate limits and provider outages: clear messages, backoff.
- IGN-08 [C] FAIL. Disconnect: does it revoke at the provider where possible and delete stored tokens? Does the Intelligence Layer stop using it immediately?
- IGN-09 [E] FAIL. Where are tokens stored (server, encrypted)? Can the browser ever read them?
- IGN-10 [D] FAIL. Webhooks: are inbound events (new issue, new email) received, verified by signature, deduplicated and turned into notifications or tasks? Which integrations support it?
- IGN-11 [C] FAIL. Is there a per-integration activity log (what the product did, when) the person can read?
- IGN-12 [H] FAIL. Do Chat, Eve, Agents, Build/Kimi (via MCP) and the Intelligence Layer use the integration through the capability contract with permission checks?
- IGN-13 [I] FAIL. Least privilege: the narrowest scopes needed. List scopes now and justify each.
- IGN-14 [C] FAIL. Dates and statuses human-formatted; no raw timestamps (BLUEPRINT 2, M18).
- IGN-15 [C] FAIL. Resolve contradictions in status text (for example Gmail saying Connected and also not connected).
- IGN-16 [C] FAIL. Is Notion on proper authorization or an API token, and is the token path clearly explained and safe?
- IGN-17 [B] FAIL. The integrations page is organized: Connected, Available, Custom MCP; searchable; each card consistent.
- IGN-18 [J] FAIL. One recorded end-to-end journey per live integration: connect, read, act, verify in the third party, disconnect (JOU-06).
- IGN-19 [A] FAIL. Any payment or financial integration (if ever added) is out of scope until security review; do not add one without the owner's written approval.
- PRV-01 [A] FAIL. List every provider and model shown. For each, prove it is callable now (a real request) or remove it.
- PRV-02 [D] FAIL. Is the selected model the model used on every path (Chat, Research, Build, Voice, Agents, Human Code)? Show request logs with the model identifier from the provider's response.
- PRV-03 [D] FAIL. Is there one model router with a written policy for Auto (BLUEPRINT 1, F3 in BLUEPRINT 2)? Is every routing decision logged with its reason?
- PRV-04 [D] FAIL. Model discovery: how are available models listed and refreshed? What happens when a model is retired?
- PRV-05 [C] FAIL. API key management: add, test, rotate, delete, last-4 display. Do keys ever reach the browser?
- PRV-06 [D] FAIL. Streaming: supported per provider, normalized to one event format.
- PRV-07 [F] FAIL. Fallbacks: when a provider fails, does failover choose the next one, tell the person, and avoid double billing? Failover default ON.
- PRV-08 [G] FAIL. Quotas, rate limits and provider health: tracked, shown in a status view, with alerts.
- PRV-09 [G] FAIL. Usage and cost per provider, model, feature and user. Is the arithmetic right (compare to provider invoices)?
- PRV-10 [F] FAIL. Error handling per provider error class (auth, quota, rate, overloaded, content filter, invalid request).
- PRV-11 [I] FAIL. Provider credentials separated by environment; no keys in the repository or logs.
- PRV-12 [I] FAIL. Which data each provider receives; disclosure in Privacy.
- PRV-13 [D] FAIL. Capability differences handled: which models support tools, images, long context, audio. Does the router avoid sending unsupported requests?
- PRV-14 [J] FAIL. A provider test page ("Test") for each provider that performs a real round trip and records the result.
- RSC-01 [A] FAIL. Is Research a real pipeline (plan, search, fetch, read, synthesize, cite) or one model call? Draw it.
- RSC-02 [D] FAIL. Which search provider and fetcher are used, and is there a working default with no setup?
- RSC-03 [D] FAIL. Does each citation correspond to a page actually fetched in this run? Build a checker that opens each cited URL record and confirms the quoted fact appears.
- RSC-04 [D] FAIL. Are claims traceable: each sentence in the report maps to one or more sources?
- RSC-05 [D] FAIL. Is fact verification implemented (cross-check important claims against a second source; mark uncertain ones)?
- RSC-06 [C] FAIL. Depth controls (Quick, Standard, Deep) have real, measured differences in sources read and time spent.
- RSC-07 [C] FAIL. Progress shown live with cancel; resumable after disconnect.
- RSC-08 [E] FAIL. Reports saved with sources and run metadata; reopenable on any device.
- RSC-09 [C] FAIL. Document analysis: upload a PDF or paper and ask questions with page citations.
- RSC-10 [C] FAIL. Export: copy, Markdown, PDF, Word; saved into Library and Projects.
- RSC-11 [H] FAIL. Can Chat, Eve, Agents and the Intelligence Layer start a research task and consume the result as structured data?
- RSC-12 [F] FAIL. Partial failure: blocked pages, paywalls, timeouts; the report says what could not be read.
- RSC-13 [I] FAIL. Prompt injection from fetched pages is neutralized; tool permissions do not widen because of page content.
- RSC-14 [G] FAIL. Time and cost per depth level; per-source reading cost; token budgets.
- RSC-15 [C] FAIL. Conflicting sources are shown with both positions.
- RSC-16 [J] FAIL. Evidence that JOU-05 (research, save to project, create document, download file) passes.
- FIL-01 [A] FAIL. List every supported file type for upload, preview, extraction and generation. Test each type with a real sample.
- FIL-02 [D] FAIL. Storage: bucket structure, naming, size limits, signed URLs, retention.
- FIL-03 [D] FAIL. Extraction: text from PDF (with OCR for scans), Word, Excel, slides, images (vision), audio (transcript), video (frames and transcript). Per type: works, partly, no.
- FIL-04 [C] FAIL. Preview: images, PDF, text, code, spreadsheets, audio, video on a phone.
- FIL-05 [C] FAIL. Editing: text and code in place; documents through a proper editor or a regenerate flow.
- FIL-06 [D] FAIL. Generated deliverables are REAL files: Word, Excel, PowerPoint, PDF, Markdown, CSV, code zip, images. Open each in its native app to confirm it opens correctly.
- FIL-07 [C] FAIL. Download and share: system share sheet, expiring links, revoke.
- FIL-08 [E] FAIL. Everything produced appears in Library with source links; deleting removes storage.
- FIL-09 [F] FAIL. Large uploads: resumable chunks; failure recovery; HEIC conversion; progress and cancel.
- FIL-10 [G] FAIL. Upload throughput and time to "ready" per file type; virus and size safeguards.
- FIL-11 [I] FAIL. Private by default; no public bucket listing; malware and type validation.
- FIL-12 [H] FAIL. Files usable by Chat, Human Code, Build (copy into workspace), Research, Agents and Eve.
- FIL-13 [C] FAIL. Image generation: provider, prompt controls, history, download, regenerate, safety refusals shown clearly.
- FIL-14 [J] FAIL. Evidence for every file type's end-to-end behavior.
- BRW-01 [A] FAIL. Does Browser use exist? What is the real mechanism (remote browser session, a driver, an extension, a paired computer)? If none, state "not implemented".
- BRW-03 [D] FAIL. Supported actions: open URL, click, type, scroll, select, upload and download files, screenshots, tabs, waiting, login persistence. Test each on real sites.
- BRW-04 [C] FAIL. Does the person see what the browser sees (live view or screenshots) and can take over?
- BRW-05 [C] FAIL. Is every action visible, interruptible and logged (what, where, screenshot)?
- BRW-06 [F] FAIL. Handling of captchas, logins, popups, page changes, timeouts; stops and asks instead of guessing.
- BRW-08 [I] FAIL. Isolation: separate profile per user, no shared cookies, no access to the app's own admin.
- BRW-09 [I] FAIL. Prompt-injection defense on pages the browser reads.
- BRW-10 [G] FAIL. Step latency and cost; session limits.
- BRW-11 [H] FAIL. Usable by the Intelligence Layer, Agents and Kimi (via tool/MCP) through the capability contract.
- BRW-12 [J] FAIL. Paired computer: pairing flow, test connection, scope of control, emergency disconnect; recorded proof.
- SET-01 [A] FAIL. Make a table of every setting: location, control type, stored where, read by which code, effect.
- SET-02 [D] FAIL. For each setting, the test that changes it and shows a real change in behavior. A setting with no effect is removed or implemented.
- SET-03 [E] FAIL. Every setting persists to the account and syncs to other devices.
- SET-04 [C] FAIL. Settings search works and lands on the right control.
- SET-05 [C] FAIL. Appearance: Dark, Light, System and accent change every screen with no mixed colors.
- SET-06 [C] FAIL. Provider failover, default models, effort defaults, web search default, voice, notifications, data controls: each verified.
- SET-07 [I] FAIL. Dangerous settings (delete data, disconnect, emergency stop) confirm and are reversible where possible.
- SET-08 [C] FAIL. "Emergency stop": exact effects listed and tested.
- SET-09 [C] FAIL. Reset to defaults per section.
- SET-10 [J] FAIL. Evidence screenshot or recording per setting group.
- NTA-01 [A] FAIL. Event types that generate notifications today; create the full list (task finished or failed, approval needed, schedule result, integration problem, security alert, credit limit...
- NTA-02 [D] FAIL. Delivery channels: in-app inbox, Home Screen push, email. Which work end to end on iPhone? Test each.
- NTA-03 [C] FAIL. Preferences per event and channel; quiet hours; digest options.
- NTA-04 [E] FAIL. Notification history, read state, and deep links that open the right screen.
- NTA-05 [D] FAIL. Schedules: one-time, daily, weekly, monthly, custom, time zone and daylight saving correctness. Run a test across a time change.
- NTA-06 [D] FAIL. Triggers: time, webhook (integration event), task completion, file arrival, inbox event. Which exist? Build the missing ones that matter.
- NTA-07 [D] FAIL. Server-side execution with the app closed; show a scheduled task running overnight.
- NTA-08 [F] FAIL. Retries with backoff; failure notification; no silent loss; no duplicate runs after a retry.
- NTA-09 [C] FAIL. Cancel, pause, resume, edit and run-now; run history with results.
- NTA-10 [G] FAIL. Scheduler accuracy (run within a minute of schedule) and load behavior with 500 schedules.
- NTA-11 [I] FAIL. Automations obey permission policies; a schedule cannot do what the person did not allow.
- NTA-12 [H] FAIL. The Intelligence Layer and Eve can create, list and change schedules by request, with receipts.
- NTA-13 [J] FAIL. Evidence of a real overnight run with a notification received.
- INF-01 [A] FAIL. Draw the real deployment diagram: hosting, functions, database, storage, queue, sandbox service, cron, third-party services.
- INF-02 [D] FAIL. Authentication: provider, session handling, token refresh, logout everywhere, password and two-factor options, account recovery.
- INF-03 [I] FAIL. Database: every table has row-level security; tests that attempt cross-user reads and writes fail.
- INF-04 [D] FAIL. Migrations: versioned, reversible, run in CI; a staging database; no manual production edits.
- INF-05 [D] FAIL. API contracts: typed, documented, validated; breaking-change policy.
- INF-06 [D] FAIL. Background workers and queue: where they run, how they scale, how failures are seen.
- INF-07 [D] FAIL. Environments: development, preview, production with separate keys; configuration documented.
- INF-08 [G] FAIL. Monitoring: error tracking, logs with request ids, uptime checks, performance traces, cost dashboard, alerts to the owner.
- INF-09 [F] FAIL. Backups: automated database and storage backups, retention, and a tested restore.
- INF-11 [I] FAIL. Security headers, CSRF, CORS, rate limiting, input validation, dependency scanning, secret scanning.
- INF-12 [I] FAIL. Rate limits and spend caps per user and global; kill switches per provider and module.
- INF-13 [G] FAIL. Scalability: what breaks first at 10, 100 and 1,000 users? Load-test the chat route and the Build gateway.
- INF-14 [F] FAIL. Long-running work does not depend on a single web request; timeouts documented.
- INF-15 [J] FAIL. Production readiness checklist signed with evidence.
- UIX-01 [A] FAIL. Inventory every screen, modal, sheet, panel, menu and state with a screenshot in Dark and Light.
- UIX-02 [C] FAIL. A design system exists (tokens, components) and is used everywhere (BLUEPRINT 1, PART 7).
- UIX-03 [C] FAIL. Visual defects list: mixed theme colors, faded buttons, overlapping layers, covered controls, unlabeled icons, clipped text, inconsistent spacing. Fix each, show before and after.
- UIX-04 [A] FAIL. Missing assets: app icon set, splash, favicon, Eve avatar states, integration logos (official), empty-state illustrations, onboarding images. Create or obtain each with approved...
- UIX-05 [C] FAIL. Motion: transitions and animations are smooth (60 frames per second target on a recent iPhone), purposeful, and respect reduced motion.
- UIX-07 [C] FAIL. Navigation is clear: one drawer, one top bar, one composer; no feature has two entry points of the same type.
- UIX-08 [C] FAIL. Copy: plain language, consistent tone, banned-term test passes.
- UIX-09 [C] FAIL. Typography and iconography are consistent; icons have labels.
- UIX-11 [C] FAIL. First-run experience: onboarding that gets a new person to a successful first message and shows the main modules.
- UIX-12 [J] FAIL. Side-by-side comparison with the reference apps for structure and polish; list remaining gaps.
- MOB-03 [C] FAIL. Safe areas, notch, home indicator, dynamic toolbars; no horizontal scroll.
- MOB-04 [C] FAIL. Touch targets; gestures; long press menus; pull to refresh where intended.
- MOB-07 [G] FAIL. Performance on a mid-range phone: load time, interaction latency, scroll smoothness, memory.
- MOB-08 [C] FAIL. Installability: manifest, icons, standalone display, update prompts; push notifications in the installed app.
- INV-01 [J] FAIL. Total elements found, total verified PASS, total removed, total fixed. Report these numbers.
- INV-02 [J] FAIL. Zero rows may remain with status NOT TESTED or FAIL at the final gate.

### windows-pc (7)

- CHT-06 [C] FAIL. Does streaming render progressively on iPhone Safari without freezing the scroll or the keyboard?
- BRW-02 [A] FAIL. The "Computer: Desktop control" and "Browser operator" entries: real or decorative?
- UIX-10 [C] FAIL. Accessibility: contrast, focus, screen reader, text scaling, hit sizes, keyboard navigation on desktop.
- MOB-01 [C] FAIL. Test matrix: iPhone small, standard, large; iPad; Android phone; desktop Safari, Chrome, Edge, Firefox; Home Screen app and browser tab.
- MOB-02 [C] FAIL. Keyboard: opening and closing never hides the composer, voice controls or primary buttons; no layout jumps.
- MOB-05 [C] FAIL. Desktop: persistent sidebar, multi-pane Build, keyboard shortcuts, hover states, window resizing.
- MOB-09 [J] FAIL. A responsive screenshot is NOT proof of function: every journey (JOU-01 to JOU-12) is run on a phone and on desktop with recordings.

### production-deploy (1)

- INF-10 [F] FAIL. Rollback: one step to previous deployment; database migrations safe to roll back or forward.

### hyperframes (0)

None matched this blocker by wording. The requirement can still be blocked by it.

### local-model (2)

- UIX-06 [C] FAIL. Every loading, empty, error, success and offline state designed and implemented (BLUEPRINT 1, 8.1).
- MOB-06 [F] FAIL. Offline and flaky network behavior; resume after the app is suspended.

### owner-notion (0)

None matched this blocker by wording. The requirement can still be blocked by it.

### owner-stage0 (0)

None matched this blocker by wording. The requirement can still be blocked by it.

### paid-or-host (1)

- BRW-07 [I] FAIL. Allow-list and deny-list of domains; no entry of passwords unless the person provides them through a secure handoff; sensitive actions (purchases, deletions, sends) always ask.

### second-review (0)

None matched this blocker by wording. The requirement can still be blocked by it.

## Smallest next build slice

The owner Speak stop is the slice being proved now. It does not close SET-08. The smallest next slice that does not need a merge or deploy is SET-09 [C]: Reset to defaults per section.
It stays on the local preview. It does not close Blueprint 92, Issue 48, or the permanent-website gate.

## Blueprint 92 proof levels

All 359 remain FAIL.

- Level A: 28
- Level B: 6
- Level C: 94
- Level D: 70
- Level E: 21
- Level F: 34
- Level G: 27
- Level H: 20
- Level I: 35
- Level J: 24
