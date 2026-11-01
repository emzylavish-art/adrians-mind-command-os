# Hardening log (append-only)

## 2026-11-01 14:25 WAT — verifier c10 on preview/integration @ 27d2985 (local preview :8120, started+stopped by verifier)

### H1. Reflected XSS in OAuth callback pages (all connectors + Notion) — CRITICAL
- Feature: OAuth connectors (gap #3) callback HTML
- Branch/commit: preview/integration 27d2985 (from mcp-integration 5dd31ef)
- File:line: src/routes/api/mind/oauth/$connector/callback.ts:5-10 (html() interpolates message/title/connector unescaped), :21 (params.connector reflected), :27 (`?error=` reflected); src/routes/api/mind/oauth/notion/callback.ts:7, :19-20
- Repro (live, unauthenticated): `curl 'http://127.0.0.1:8120/api/mind/oauth/gmail/callback?error=%3Cimg%20src%3Dx%20onerror%3Dalert(document.domain)%3E'` → HTTP 400 body contains `<img src=x onerror=alert(document.domain)>` raw. Also `/api/mind/oauth/%3Csvg%20onload%3Dalert(1)%3E/callback` and `/api/mind/oauth/notion/callback?error=%3Cscript%3Ealert(1)%3C/script%3E` (raw `<script>` returned).
- Impact: any link runs attacker JS on the app origin → session/bearer theft, calls to /api/mind/* as the victim (Imagine spend, connector disconnect, tokens). Also the provider's error_description (token exchange) flows into the same sink.
- Fix: HTML-escape every interpolated value; whitelist connector before rendering; add CSP; postMessage to own origin not "*".
- Owning lane: MCP Integration Bot

### H2. Path traversal in OAuth `state` → arbitrary .json read+DELETE and connection hijack — CRITICAL (when a provider is configured)
- Feature: OAuth connectors (gap #3) pending-state store
- File:line: src/lib/mind/connectors/store.ts:145-149 (`join(directory,"pending",`${state}.json`)` then JSON.parse + unlinkSync, no validation of state); reached unauthenticated from callback.ts:23-24 → oauth-provider.ts:131
- Repro (unit, temp dir, verified): setConnectorDirectory('/tmp/trav/conn'); takePendingOAuth('../../victim/important') → returned file contents `{"keep":"me"}` and the file /tmp/trav/victim/important.json was DELETED. Live: `GET /api/mind/oauth/gmail/callback?code=x&state=..%2F..%2F..%2Fpackage` would delete <cwd>/package.json once GOOGLE_OAUTH_* is set (on unconfigured preview it short-circuits at oauth-provider.ts:128, HTTP 400 "not configured").
- Escalation: state=`../<sha256(ownerId)>/gmail` reads the victim's stored connection (has ownerId+connector fields so oauth-provider.ts:132 check passes), deletes it, then stores the ATTACKER's code/token under the victim's ownerId (account substitution; sha256("dev-user") is trivially known).
- Fix: require state to match /^[A-Za-z0-9_-]{32}$/ before any fs access; compare resolved path stays inside pending dir.
- Owning lane: MCP Integration Bot

### H3. OAuth pending state never expires and is not bound to the callback session — MED
- File:line: src/lib/mind/connectors/oauth-provider.ts:131-134 (createdAt stored at :96 but never checked); store.ts:139-142 (pending files never pruned)
- Repro: GET /api/mind/oauth/gmail/start?format=json (signed in) → keep `state` for days → callback still accepted; nothing checks the callback requester is pending.ownerId. Unbounded growth of .data/mind-connectors/pending/*.json by repeated /start calls.
- Impact: stale-state replay, disk growth (DoS), weak CSRF binding.
- Fix: 10-min TTL, prune on start, bind state to session cookie (or verify current user === pending.ownerId).
- Owning lane: MCP Integration Bot

### H4. Imagine generate: client controls `model` on the server's xAI key — MED
- Feature: Grok Imagine (gap #2)
- Branch/commit: preview/integration 27d2985 (from media-integration ef8f6b8)
- File:line: src/lib/mind/media/imagine-http.ts:54 → imagine.ts:118 (any string forwarded to api.x.ai), error echoes `model` back at imagine-http.ts:75
- Repro: signed-in `POST /api/mind/media/generate {"prompt":"x","model":"<any model id>","n":4}` → forwarded as-is to xAI with the box key.
- Impact: any signed-in session (or XSS via H1) can pick arbitrary/expensive models on the owner's key; no per-user rate limit on this route (contrast searchWeb's allowMindRequest).
- Fix: allowlist models (grok-imagine-image*), add allowMindRequest("imagine", userId, N) + halt check.
- Owning lane: Media Integration Bot

### H5. Imagine generate/edit: unbounded request body and edit image size — MED
- File:line: src/lib/mind/media/imagine-http.ts:44 (`request.json()` no size cap); imagine.ts:225 (edit only checks `startsWith("data:image/")`, no MAX_DATA_URL_CHARS check before upload); imagine.ts:89 (download of upstream URL fully buffered before the size check at :69)
- Repro: signed-in `POST /api/mind/media/generate` with `{"prompt":"x","image":"data:image/png;base64,"+200MB}` → whole body parsed into memory and forwarded to xAI.
- Impact: memory DoS on the server; wasted upstream spend.
- Fix: reject Content-Length > ~12MB; enforce MAX_DATA_URL_CHARS on input image; stream-cap downloads.
- Owning lane: Media Integration Bot

### H6. Imagine: wrong status for client errors + upstream error text relayed verbatim — LOW
- File:line: imagine-http.ts:56,74 (`mode:"edit"` with no/invalid image → editImagineImage returns no status → mapped to 502, should be 400); imagine.ts:156-163 & edit path (upstream xAI error.message passed straight to the client)
- Repro: signed-in `POST /api/mind/media/generate {"prompt":"x","mode":"edit"}` → 502 "Edit with Imagine needs an image data URL as input." (a client error shown as upstream failure).
- Impact: error banners blame upstream; upstream internals leak to UI.
- Owning lane: Media Integration Bot (banner copy: Error Banners Bot)

### H7. xai-key resolver mutates process.env — LOW
- File:line: src/lib/mind/media/xai-key.ts:33 (`env.XAI_API_KEY = fromFile`)
- Repro: call resolveXaiInferenceApiKey() once → process.env.XAI_API_KEY is overwritten for the whole server process (and any child processes / env dumps / debug endpoints).
- Impact: silent cross-feature key swap; key spreads into spawned child env.
- Fix: return the value only, never write process.env.
- Owning lane: Media Integration Bot

### H8. Web search has no timeout — a hung search endpoint hangs the turn (deep research = 3 serial unbounded fetches) — MED (LOGIC LANE)
- Feature: web search/citations
- Branch/commit: preview/integration 27d2985 (logic-wiring beebc80 timeouts not applied to search)
- File:line: src/lib/mind/server.ts:95-99 (searchWeb calls performSearch with no `signal`); src/lib/mind/research.ts:119 (fetch with `signal: undefined`); research.ts:161-166 (deep loop of up to 3 sequential fetches); turn-timeouts.ts boundAbortSignal is never used here
- Repro: set MIND_SEARCH_ENDPOINT to a local server that accepts and never responds (e.g. `node -e "require('http').createServer(()=>{}).listen(9999)"`), MIND_SEARCH_KEY=x; run search with a ≥160-char query → server fn never resolves (no 30s budget, no "Timed out" honest error); unit: performSearch({query,endpoint,key,fetchImpl:()=>new Promise(()=>{})}) never settles.
- Impact: spinner forever / silent failure, breaks the "never hang" contract; also response.json() on a huge body is unbounded.
- Fix: wrap with boundAbortSignal(req.signal, chatTurnTimeoutMs()) (per-query budget for deep), map TimeoutError to an honest "Search timed out. No citations were created."
- Owning lane: Logic Bot

### Observation (not a weakness, needs check): Merge Gate screenshot /workspace/audit/integration-c10-serviceboard.png shows GitHub/Gmail/Drive/Calendar/Slack stuck on "Checking connection…" and Notion "status could not be read" — verify the status fetch (service-board.tsx:88) resolves to an honest state on 401/500 instead of spinning. Owning lane: MCP Integration Bot / Error Banners Bot.

## 2026-11-01T14:45:03+01:00 — Gap Dispatcher c16 attack pass (read-only, mcp-integration @ d50da97)

### H9. pc_run_shell allowlist bypass: "confirm" is a caller-supplied tool argument — HIGH
- File: src/lib/mind/mcp/builtin-server.ts:60-69 (inputSchema confirm: z.boolean().optional() passed straight to pcRunShell -> pc-pairing/run.ts:27,39 -> enqueueJob confirm)
- Repro: authenticated POST /api/mind/mcp/builtin tools/call pc_run_shell {"command":"<non-allowlisted cmd>","confirm":true} -> job enqueued for the paired PC. Same via the agent: a prompt-injected search result / Notion page telling the model to call pc_run_shell with confirm:true.
- Impact: the "explicit confirmation" gate is decided by the model or any MCP client, not a human; any prompt injection reaching tool-use can run arbitrary shell on the paired HP EliteBook once paired.
- Fix: confirmation must be an out-of-band human approval (server-issued one-time approval id from a UI click, bound to owner+command hash, short TTL); ignore/strip confirm from tool args; regression tests for confirm:true without approval, replayed approval, and command mismatch.
- Owning lane: MCP Integration Bot (HP Pairing Bot consulted for pc-pairing/run.ts contract)

## 2026-11-01T14:52:00+01:00 — Gap Dispatcher c17 attack pass (read-only, visual/polish-pass-8 message-body.tsx)

### H10. Copy-code silent failure + no Markdown sanitisation contract — LOW (becomes HIGH if Markdown is added unsafely)
- File: src/components/mind/message-body.tsx:17-19 (clipboard .catch(() => setCopied(null)) — no user feedback; "Copied" state never resets; no aria-live)
- Repro: open preview over plain http (non-secure context) or deny clipboard permission, click "Copy code" → nothing happens, no error.
- Risk ahead: replies are plain text today (safe), but the Markdown-rendering gap dispatched this cycle must not introduce raw HTML; model output can carry prompt-injected `<img onerror>` / `javascript:` links from search/tool results.
- Owning lane: Visual Polish Bot (visual-polish-gap-markdown-rendering.lock)

## 2026-11-01T14:57:00+01:00 — Gap Dispatcher c19 attack pass (read-only, voice-integration @ f4ff6e1, src/lib/mind/server.ts + voice/)

### H11. Voice server fns: unbounded base64 decode, no runtime type checks, client-controlled mime/filename, unguarded JSON parse — MED
- transcribeAudio (server.ts ~386-415): validator is a passthrough `(input) => input`. `audioBase64` is decoded with Buffer.from BEFORE the 4MB check, so an authenticated caller can post a very large string and force a full decode in memory (12 req/min allowed). Non-string `audioBase64` (number/object/null) → `.trim` TypeError → unhandled 500 instead of an honest error.
- `mime` and `filename` are client-controlled and forwarded verbatim into the upstream multipart (any type, e.g. text/html; any filename length/charset).
- speakText (~344): `data.text.trim()` with no type check → TypeError on non-string; no length check before trim on huge strings.
- client-secret.ts: `await response.json()` on a 200 is not try/caught → non-JSON upstream body throws (silent 500); `expires_at` falls back to 0 so the client cannot tell expiry.
- TTS: full upstream `arrayBuffer()` read before the 2MB cap (no streamed cap).
- Repro (code-level): call the transcribeAudio server fn with `{audioBase64: 12345}` or a 50MB base64 string; call speakText with `{text: null}`.
- Fix: real validators (string, max encoded length ~5.4MB checked before decode, mime allowlist audio/webm|wav|ogg|mpeg|mp4, filename sanitised/capped), try/catch JSON in client-secret, regression tests for each.
- Owning lane: Voice Integration Bot (voice-integration)

- Status: DONE @ voice-integration (H11 input validation + speaking/interrupt/transcript polish). Encoded base64 capped before decode; speakText typed+capped; mime allowlist; filename sanitised; client-secret JSON try/catch + expires_at required. Speaking held until playback end; Interrupt hidden when idle; voice transcripts → chat. Regression: voice-input/speaking-playback/transcript-routing.

## 2026-11-01T15:01:43+01:00 — Gap Dispatcher c20 attack pass (read-only, mcp-integration @ c2266bb + logic-wiring @ e6b0c62)

### H12. pglite_query guard bypass via comment markers inside string literals — HIGH
- File: src/lib/mind/mcp/tools.ts:398-426 (assertReadOnlySql strips --/block comments with regex that ignores quoting, then runs all checks on the stripped text while executing the original)
- Repro (bun, guard only): `SELECT '--' AS a, set_config('search_path','evil',false)` -> ok:true; `SELECT '/*' AS a, pg_sleep(60), '*/' AS b` -> ok:true.
- Impact: re-opens the exact side-effect functions c2266bb blocked (search_path poisoning, event-loop freeze, likely writes) via prompt-injected tool calls.
- Owning lane: MCP Integration Bot

### H13. recordAgentExecution: client-forged tool-run records, no rate limit — MED
- File: src/lib/mind/server.ts ~101-118 (logic-wiring e6b0c62)
- Repro (code-level): signed-in loop calling recordAgentExecution {id:"x",tool:"pc_run_shell",ok:true} -> fake runs written to DB/Notion timeline with no limit.
- Impact: audit trail untrustworthy; Notion block-quota burn. Minor: limits.ts windows Map never pruned.
- Owning lane: Logic Bot

## 2026-11-01T15:12:00+01:00 — Gap Dispatcher c21 attack pass (read-only, voice-wiring @ e527875, src/lib/mind/voice/hold-to-talk.ts)

### H14. Space hold-to-talk opens the mic on non-button ARIA widgets and inside open modals — LOW/MED (privacy: unexpected mic activation)
- isHoldToTalkBlockedTarget only blocks inputs/contenteditable, button/a/summary and role button|textbox|combobox. Space is the native activation key for role tab, option, menuitem(checkbox|radio), checkbox, radio, switch (non-button), slider, listbox, treeitem, gridcell; none are blocked. No check for an open aria-modal dialog (Cmd-K palette, shortcut sheet, confirm dialogs), so holding Space while keyboard-navigating a dialog (focus on a dialog div or option row) starts a realtime voice session behind the modal.
- Repro (code read): focus any element with role="option"/"tab" or the dialog container itself (tabindex=-1), hold Space >180 ms → controller.start → listenRef.current() mints a voice secret and opens the mic.
- Fix: block the full ARIA interactive-role set and any target inside [aria-modal='true'] / [role='dialog'] (or when any aria-modal dialog is open); regression tests per role + modal-open case.
- Owning lane: Voice Wiring Bot (voice-wiring)
- Status: dispatched c21 (voice-wiring-gap-ptt-aria-modal-guard.lock)

## 2026-11-01T15:11:17+01:00 — Gap Dispatcher c22 attack pass (read-only, mcp-integration @ af084a4, src/lib/mind/mcp/tools.ts pgliteQuery)

### H15. pglite_query timeout is ineffective: CPU-bound SELECT freezes the whole Node server — HIGH (DoS via prompt-injected tool call)
- File:line: tools.ts:806-811 (Promise.race + setTimeout), db.ts:114-117 (PGlite runs in-process WASM, no worker); no statement_timeout set.
- Repro (confirmed on box, local PGLite only): Promise.race([db.query("SELECT * FROM (SELECT count(*) FROM generate_series(1,30000000)) AS _mind_q LIMIT 100"), 500ms timeout]) → query finished at 6629 ms, timeout never fired, setInterval(50ms) ticked 0 times. Guard passes it (generate_series, cross joins of pg_catalog, recursive CTEs, regex backtracking are not side-effect functions). Larger series = unbounded freeze of every request, voice and OAuth included.
- Impact: same class as the pg_sleep block H12 closed — one tool call (or prompt-injected search/tool result) hangs the server.
- Fix: run pglite_query on a dedicated PGlite worker/worker_thread (terminate on timeout) or a separate read-only PGlite instance in a Worker; also SET LOCAL statement_timeout inside the READ ONLY txn as defense-in-depth; fail closed if BEGIN READ ONLY is rejected (tools.ts:802-805 currently continues without it). Regression test: CPU-heavy query returns a timeout error within timeoutMs+slack while a concurrent timer keeps ticking.
- Owning lane: MCP Integration Bot
