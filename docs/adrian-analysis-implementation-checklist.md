# Adrian Analysis — complete C4 finding-to-fix checklist

**Audit:** C4, Audit Notion Recovery and Settings / Adrian Analysis. **Chapter ID:** `4231aa2763238158bd39d4c8d58191dc`.
**Archive:** [C4 chapter](https://app.notion.com/p/4231aa2763238158bd39d4c8d58191dc) · [archive index](https://app.notion.com/p/4231aa2763238172a515d9ecebc9aa3d).
**Implementation base:** `18d5b9364e6bdcfec028eeccf56fe596946ed8ce`. **Resumed branch:** `audit/adrian-analysis-66-1125`; earlier branch head `e2fff1abcd650fee0849d905b23fe0a2253be241`.

## Coverage and evidence boundaries

All 21 archived C4 child records were read through their end markers. Every ID AA-001 through AA-066 is accounted for below. The standalone Pass 5 original is absent from the archive: AA-011–014 were recovered from its detailed inherited summary and later cumulative records. That bounded source gap is retained; no extra findings have been invented.

Implementation and test fixtures use this branch, not the old production audit SHA. Local synthetic accounts, fake provider replies and isolated databases do not establish a successful live account/provider/device operation. No production database, account setting, release, main merge, Windows installer or native application was changed. Branch and draft PR publication are separately reported in the final handoff.

The row status describes the implemented scope and its targeted proof. Full-suite, typecheck, lint and build gates are reported separately in [verification](adrian-analysis-verification.md); a resource-killed check is never a pass.

## Every original finding

| ID / original source | Original title | Expected behavior | Disposition | Workstream / proof |
|---|---|---|---|---|
| [AA-001](https://app.notion.com/p/4231aa2763238104bb34df725195c48b?pvs=204) | Recovery can duplicate a Notion append that was already accepted | Accepted or uncertain append recovery must never append again. | **fixed and tested** | [G01](#g01-notion-recovery) |
| [AA-002](https://app.notion.com/p/4231aa2763238104bb34df725195c48b?pvs=204) | Integrations presents a static catalog as recently checked connection information | Connection labels and timestamps must describe evidence for the current owner. | **fixed and tested** | [G02](#g02-integration-status) |
| [AA-003](https://app.notion.com/p/4231aa276323816ab14bef85ae5a036e?pvs=204) | Live Speak does not use the selected text provider for its answering stage | Typed and recorded microphone answers must use the selected capable text route. | **fixed and tested** | [G03](#g03-voice-stages) |
| [AA-004](https://app.notion.com/p/4231aa276323816ab14bef85ae5a036e?pvs=204) | Cloud dictation can substitute OpenAI without a transcription-provider choice | Failed transcription must not silently authorize a different paid provider. | **fixed and tested** | [G03](#g03-voice-stages) |
| [AA-005](https://app.notion.com/p/4231aa276323816ab14bef85ae5a036e?pvs=204) | A failed Ollama check changes the saved voice preference to Direct | Unavailable local direction must preserve the selected preference. | **fixed and tested** | [G03](#g03-voice-stages) |
| [AA-006](https://app.notion.com/p/4231aa276323816c8bc4ea9ba2413a8a?pvs=204) | Settings does not keep the address, visible pane and reading position together | Settings pane must survive deep link, back and reload. | **fixed and tested** | [G04](#g04-navigation) |
| [AA-007](https://app.notion.com/p/4231aa276323816c8bc4ea9ba2413a8a?pvs=204) | The first navigation can overwrite the page that Back should return to | The first user navigation must be a Back-reachable history entry. | **fixed and tested** | [G04](#g04-navigation) |
| [AA-008](https://app.notion.com/p/4231aa276323816c8bc4ea9ba2413a8a?pvs=204) | Reloading an Intelligence thread can select a different thread | Intelligence reload must restore the selected thread. | **fixed and tested** | [G04](#g04-navigation) |
| [AA-009](https://app.notion.com/p/4231aa276323817095bbd25f8bb9962c?pvs=204) | Debug offers a recovery path that cannot make Debug available | Debug must truthfully reflect the host capability. | **fixed and tested** | [G05](#g05-build-editor) |
| [AA-010](https://app.notion.com/p/4231aa276323817095bbd25f8bb9962c?pvs=204) | Build’s editor renders an empty white output strip and inconsistent tool surfaces | Editor themes and empty output should remain clean and readable. | **fixed and tested** | [G05](#g05-build-editor) |
| [AA-011](https://app.notion.com/p/4231aa27632381b28fcae62e9ed26666?pvs=204) | All-files upload falls back to hidden composer project | Library upload must use the visible destination. | **fixed and tested** | [G06](#g06-library-destinations) |
| [AA-012](https://app.notion.com/p/4231aa27632381b28fcae62e9ed26666?pvs=204) | Library preview remains on previous project file | Preview must belong to the selected Library scope. | **fixed and tested** | [G06](#g06-library-destinations) |
| [AA-013](https://app.notion.com/p/4231aa27632381b28fcae62e9ed26666?pvs=204) | Library Browse Drive stages a chat attachment | Drive Library import must save to that destination, without sending/staging chat. | **fixed and tested** | [G06](#g06-library-destinations) |
| [AA-014](https://app.notion.com/p/4231aa27632381b28fcae62e9ed26666?pvs=204) | Signed-out Library upload says Saved but is ephemeral | Signed-out Library must not claim account persistence. | **fixed and tested** | [G06](#g06-library-destinations) |
| [AA-015](https://app.notion.com/p/4231aa27632381b28fcae62e9ed26666?pvs=204) | Automatic scheduling can become stuck after authentication finishes loading | Scheduler must use the current owner after delayed auth or switching. | **fixed and tested** | [G07](#g07-schedules) |
| [AA-016](https://app.notion.com/p/4231aa27632381b28fcae62e9ed26666?pvs=204) | The desktop timezone field cuts off the selected timezone | Time zone must remain readable in the responsive schedule form. | **fixed and tested — responsive CSS changed; browser geometry result is tracked in verification** | [G07](#g07-schedules) |
| [AA-017](https://app.notion.com/p/4231aa27632381038d80dd42a09592fa?pvs=204) | MCP approval is not bound to a freshly verified tool definition | Changed MCP capabilities must invalidate old approval. | **fixed and tested** | [G08](#g08-mcp-approvals-and-cancellation) |
| [AA-018](https://app.notion.com/p/4231aa27632381038d80dd42a09592fa?pvs=204) | MCP argument validation loses parts of the advertised schema | Every supported schema constraint must be enforced before dispatch. | **fixed and tested** | [G08](#g08-mcp-approvals-and-cancellation) |
| [AA-019](https://app.notion.com/p/4231aa27632381038d80dd42a09592fa?pvs=204) | Dismissing a pending MCP result does not invalidate its attempt | Dismissed or replaced MCP operation results must not restore stale UI. | **fixed and tested** | [G08](#g08-mcp-approvals-and-cancellation) |
| [AA-020](https://app.notion.com/p/4231aa27632381c9a3fbd326e2ff1435?pvs=204) | Model request preparation can retain outdated memory permissions | Dispatch must use current saved-memory permission. | **fixed and tested** | [G09](#g09-current-context-permission) |
| [AA-021](https://app.notion.com/p/4231aa27632381c9a3fbd326e2ff1435?pvs=204) | Recovery can reuse previously assembled memory context | Recovery must not replay a previously authorized context payload. | **fixed and tested** | [G09](#g09-current-context-permission) |
| [AA-022](https://app.notion.com/p/4231aa27632381c9a3fbd326e2ff1435?pvs=204) | The memory switch does not govern every category of model context | Saved memory, history, knowledge and personality must be distinguished. | **fixed and tested** | [G09](#g09-current-context-permission) |
| [AA-023](https://app.notion.com/p/4231aa2763238195aaa0e254f75a8962?pvs=204) | Emergency stop does not directly invoke Build task cancellation | Global stop must affect Build even when its screen is absent. | **fixed and tested** | [G10](#g10-durable-stop-and-build-lifecycle) |
| [AA-024](https://app.notion.com/p/4231aa2763238195aaa0e254f75a8962?pvs=204) | Build planning has a separate abort-controller lifecycle | Stopped planning must ignore late chunks and block queued submission. | **fixed and tested** | [G10](#g10-durable-stop-and-build-lifecycle) |
| [AA-025](https://app.notion.com/p/4231aa2763238195aaa0e254f75a8962?pvs=204) | Custom MCP calls check emergency stop at entry, not between every execution stage | Halt/disable must be checked after tool initialization. | **fixed and tested** | [G08](#g08-mcp-approvals-and-cancellation) |
| [AA-026](https://app.notion.com/p/4231aa2763238195aaa0e254f75a8962?pvs=204) | Emergency-stop presentation needs separate confirmation states | Cancellation requested must not be labeled confirmed completion. | **fixed and tested** | [G10](#g10-durable-stop-and-build-lifecycle) |
| [AA-027](https://app.notion.com/p/4231aa276323815fbc73edcb28d97371?pvs=204) | Server revision conflicts cannot be resolved through the existing Retry save workflow | CAS conflict retry must fetch and use a current revision. | **fixed and tested** | [G11](#g11-workspace-reconciliation) |
| [AA-028](https://app.notion.com/p/4231aa276323815fbc73edcb28d97371?pvs=204) | Reloading can convert a protected revision conflict into a destructive replacement opportunity | A partial local snapshot must not delete unseen remote records. | **fixed and tested** | [G11](#g11-workspace-reconciliation) |
| [AA-029](https://app.notion.com/p/4231aa276323815fbc73edcb28d97371?pvs=204) | Same-browser synchronization updates memory but not the complete live workspace | Storage events must reconcile all workspace collections. | **fixed and tested** | [G11](#g11-workspace-reconciliation) |
| [AA-030](https://app.notion.com/p/4231aa276323815fbc73edcb28d97371?pvs=204) | Concurrent edits to different fields of the same record can overwrite each other | Unrelated field edits must merge and true conflicts must be reviewable. | **fixed and tested** | [G11](#g11-workspace-reconciliation) |
| [AA-031](https://app.notion.com/p/4231aa27632381eb9f12ce61ad7460a4?pvs=204) | Local image persistence does not establish cross-device image availability | Portable image references require verified owner-scoped bytes. | **fixed and tested** | [G12](#g12-attachment-integrity) |
| [AA-032](https://app.notion.com/p/4231aa27632381eb9f12ce61ad7460a4?pvs=204) | Oversized individual images can disappear during normalization | Oversized image failure must preserve the original local bytes. | **fixed and tested** | [G12](#g12-attachment-integrity) |
| [AA-033](https://app.notion.com/p/4231aa27632381eb9f12ce61ad7460a4?pvs=204) | Missing image bytes can be excluded from subsequent model context | Missing images must be visible and excluded honestly from requests. | **fixed and tested** | [G12](#g12-attachment-integrity) |
| [AA-034](https://app.notion.com/p/4231aa27632381eb9f12ce61ad7460a4?pvs=204) | Archive integrity does not establish attachment completeness | Archive integrity must state whether attachment bytes are complete. | **fixed and tested** | [G12](#g12-attachment-integrity) |
| [AA-035](https://app.notion.com/p/4231aa27632381eb9f12ce61ad7460a4?pvs=204) | Legacy image fallback weakens account-specific storage boundaries | Unowned legacy caches must not cross account boundaries. | **fixed and tested** | [G12](#g12-attachment-integrity) |
| [AA-036](https://app.notion.com/p/4231aa276323810d9de1d5dd42755a1e?pvs=204) | Ordinary model requests retain only the latest 12 historical messages | Early important context must not be lost to repeated fixed last-12 slicing. | **fixed and tested** | [G13](#g13-context-selection) |
| [AA-037](https://app.notion.com/p/4231aa276323810d9de1d5dd42755a1e?pvs=204) | History selection is not adaptive to the selected model's context capacity | Budgeting should use verified per-model input/output capacities when available. | **proposal needing a decision — conservative ceilings implemented/tested; verified upstream model-capacity registry is not available** | [G13](#g13-context-selection) |
| [AA-038](https://app.notion.com/p/4231aa276323810d9de1d5dd42755a1e?pvs=204) | Historical images are removed to satisfy request size without a context-exclusion receipt | Image-budget omission must be visible in the send context receipt. | **fixed and tested** | [G13](#g13-context-selection) |
| [AA-039](https://app.notion.com/p/4231aa27632381b383fdd59196635d40?pvs=204) | Interrupted generation discards visible partial responses | Received partial text must survive interruption. | **fixed and tested** | [G14](#g14-streaming-and-send-recovery) |
| [AA-040](https://app.notion.com/p/4231aa27632381b383fdd59196635d40?pvs=204) | Stop generation and retry have different delivery semantics that require stronger verification | Stopped/uncertain retry must not silently create a new paid execution. | **fixed and tested** | [G14](#g14-streaming-and-send-recovery) |
| [AA-041](https://app.notion.com/p/4231aa27632381b383fdd59196635d40?pvs=204) | Streamed text and the final stored response use separate content paths | Parsers must agree on errors, framing, terminal markers and cancellation. | **fixed and tested** | [G14](#g14-streaming-and-send-recovery) |
| [AA-042](https://app.notion.com/p/4231aa27632381b383fdd59196635d40?pvs=204) | Streaming progress is not represented as a durable conversation record | Streaming checkpoints must be clearly incomplete after reload. | **fixed and tested** | [G14](#g14-streaming-and-send-recovery) |
| [AA-043](https://app.notion.com/p/4231aa27632381adbc7bd929061e72bd?pvs=204) | Several provider routes do not propagate token usage or request IDs | Returned provider usage and actual model must reach recorded usage. | **fixed and tested** | [G15](#g15-execution-receipts) |
| [AA-044](https://app.notion.com/p/4231aa27632381adbc7bd929061e72bd?pvs=204) | Failed and interrupted Chat requests are excluded from the inspected usage-recording path | Failed/uncertain calls need honest usage; known preflight rejection is not execution. | **fixed and tested** | [G15](#g15-execution-receipts) |
| [AA-045](https://app.notion.com/p/4231aa27632381adbc7bd929061e72bd?pvs=204) | The 200-entry usage history is unsuitable as a lifetime accounting ledger | Recent history must not be confused with configurable lifetime accounting. | **proposal needing a decision — recent list is explicitly bounded/tested; lifetime retention/privacy policy is unspecified** | [G15](#g15-execution-receipts) |
| [AA-046](https://app.notion.com/p/4231aa27632381adbc7bd929061e72bd?pvs=204) | Multi-provider orchestration requires individual execution receipts | Every dispatched helper must have its own deduplicated execution receipt. | **fixed and tested** | [G15](#g15-execution-receipts) |
| [AA-047](https://app.notion.com/p/4231aa27632381d8b12dd07d9d1c7487?pvs=204) | Global search exposes only the first matching message in each conversation | Every matching message in a chat must be reachable. | **fixed and tested** | [G16](#g16-local-search) |
| [AA-048](https://app.notion.com/p/4231aa27632381d8b12dd07d9d1c7487?pvs=204) | Search relevance ranking is limited to exact result-label matches | Ranking must favor deterministic meaningful matches. | **fixed and tested** | [G16](#g16-local-search) |
| [AA-049](https://app.notion.com/p/4231aa27632381d8b12dd07d9d1c7487?pvs=204) | Search requires a contiguous matching phrase | Reordered keywords and exact phrases must be supported locally. | **fixed and tested** | [G16](#g16-local-search) |
| [AA-050](https://app.notion.com/p/4231aa27632381d8b12dd07d9d1c7487?pvs=204) | Search coverage does not include several important workspace categories | Supported saved record types need exact destinations. | **fixed and tested** | [G16](#g16-local-search) |
| [AA-051](https://app.notion.com/p/4231aa27632381d8b12dd07d9d1c7487?pvs=204) | Search excerpts are not consistently centered around matching content | Excerpts must show the matched content. | **fixed and tested** | [G16](#g16-local-search) |
| [AA-052](https://app.notion.com/p/4231aa2763238112b552d4b569b60cab?pvs=204) | Queued messages depend on a hidden long-press removal gesture | Queue removal must be a keyboard-accessible named action. | **fixed and tested** | [G17](#g17-accessible-actions) |
| [AA-053](https://app.notion.com/p/4231aa2763238112b552d4b569b60cab?pvs=204) | Global search pinning is exposed through a pointer-hold gesture | Pinning must be visible and operable without a context menu. | **fixed and tested** | [G16](#g16-local-search) |
| [AA-054](https://app.notion.com/p/4231aa2763238112b552d4b569b60cab?pvs=204) | Overlay semantics and keyboard focus behavior are inconsistent | Blocking dialogs must contain focus and restore their invoker. | **fixed and tested** | [G17](#g17-accessible-actions) |
| [AA-055](https://app.notion.com/p/4231aa2763238112b552d4b569b60cab?pvs=204) | The search shortcut indicator is not platform-adaptive | Shortcut hints must match the input platform. | **fixed and tested** | [G17](#g17-accessible-actions) |
| [AA-056](https://app.notion.com/p/4231aa2763238112b552d4b569b60cab?pvs=204) | Loading announcements and streaming accessibility require a unified lifecycle | Response lifecycle must be announced without token spam. | **fixed and tested** | [G17](#g17-accessible-actions) |
| [AA-057](https://app.notion.com/p/4231aa2763238124b037e9eb5f111253?pvs=204) | Client and server authentication can select different account identities | All auth sources must resolve to one verified owner or an explicit conflict. | **fixed and tested** | [G18](#g18-canonical-identity) |
| [AA-058](https://app.notion.com/p/4231aa2763238124b037e9eb5f111253?pvs=204) | The main workspace discards the distinction between session loading and signed-out state | Pending auth must not display or hydrate another scope. | **fixed and tested** | [G18](#g18-canonical-identity) |
| [AA-059](https://app.notion.com/p/4231aa2763238124b037e9eb5f111253?pvs=204) | Preview sign-in completion is not explicitly bound to the initiating popup | OAuth completion must bind to the initiated popup transaction. | **fixed and tested** | [G18](#g18-canonical-identity) |
| [AA-060](https://app.notion.com/p/4231aa2763238124b037e9eb5f111253?pvs=204) | Account switching signs out the existing session before the new sign-in succeeds | Canceled/failed account switching must retain recoverable scoped work. | **fixed and tested** | [G18](#g18-canonical-identity) |
| [AA-061](https://app.notion.com/p/4231aa2763238124b037e9eb5f111253?pvs=204) | Session expiration during an operation needs a dedicated recovery contract | Expired sessions must offer original-owner receipt recovery without resending. | **fixed and tested** | [G14](#g14-streaming-and-send-recovery) |
| [AA-062](https://app.notion.com/p/4231aa276323817e8455cb3953a72033?pvs=204) | Long conversations render every stored message simultaneously | Long history needs measured bounded repeated work while retaining navigation. | **fixed and tested — profiling/memoization stage; conditional virtualization is not implemented** | [G19](#g19-rendering-performance) |
| [AA-063](https://app.notion.com/p/4231aa276323817e8455cb3953a72033?pvs=204) | Streaming updates can repeatedly traverse the existing conversation | New stream chunks must not reparse unchanged historical content. | **fixed and tested** | [G19](#g19-rendering-performance) |
| [AA-064](https://app.notion.com/p/4231aa276323817e8455cb3953a72033?pvs=204) | Workspace storage-size calculation serializes the complete workspace on changes | Hidden storage statistics must not serialize each workspace update. | **fixed and tested** | [G19](#g19-rendering-performance) |
| [AA-065](https://app.notion.com/p/4231aa276323817e8455cb3953a72033?pvs=204) | Server persistence rewrites entire record collections for each accepted snapshot | Small edits must produce proportionate database writes. | **fixed and tested** | [G20](#g20-incremental-persistence) |
| [AA-066](https://app.notion.com/p/4231aa276323817e8455cb3953a72033?pvs=204) | Search recalculation depends on the entire workspace rather than searchable collections | Palette recalculation must follow searchable record changes. | **fixed and tested** | [G16](#g16-local-search) |

## Implementation and targeted acceptance proof

### G01 Notion recovery

**Findings:** AA-001.

Owner/workspace/page-bound durable operation receipts prevent another append on retry or reconnect. Accepted results verify returned block IDs; uncertain acknowledgments remain inspect-only. Recovery notices survive reload.

**Affected files:** `src/lib/mind/notion.ts`, `src/lib/mind/notion-write-receipt.ts`, `src/lib/mind/server.ts`, `src/lib/mind/notion-recovery.ts`, `src/components/mind/command-app.tsx`.

**Regression / evidence:** `src/lib/mind/audit-connection-integrity.test.ts`, `src/lib/mind/adrian-analysis-regressions.test.ts`.

### G02 Integration status

**Findings:** AA-002.

Notion reads the same authenticated status source as Plugins. Catalog descriptions have no operation-verification timestamp; saved authorization, signed-out and unavailable states are distinct.

**Affected files:** `src/components/mind/notion-integration-card.tsx`, `src/lib/mind/notion-integration-status.ts`, `src/components/mind/command-app.tsx`.

**Regression / evidence:** `src/lib/mind/audit-connection-integrity.test.ts`.

### G03 Voice stages

**Findings:** AA-003, AA-004, AA-005.

Recorded microphone turns use the selected chat provider. Input, answer and speech are distinct; browser speech or explicitly chosen xAI output is supported. No silent STT failover or overwritten Ollama choice. Delayed mute, zero volume, interruption, owner changes and actual answer receipts are handled.

**Affected files:** `src/lib/mind/voice/stage-routing.ts`, `src/lib/mind/voice/provider-fallback.ts`, `src/lib/mind/voice/http.server.ts`, `src/lib/mind/voice/errors.ts`, `src/components/mind/speak-stage.tsx`, `src/components/mind/command-app.tsx`.

**Regression / evidence:** `scripts/adrian-audit-voice-auth.test.mjs`, `scripts/adrian-audit-speak-lifecycle.test.mjs`, `scripts/adrian-audit-deliver-lifecycle.test.mjs`, `src/lib/mind/voice/provider-fallback.test.ts`, `src/lib/mind/voice/direct-mode.test.ts`.

### G04 Navigation

**Findings:** AA-006, AA-007, AA-008.

Settings pane is URL state, first navigation pushes history, popstate does not add another entry, pane entry resets the scroller/focus, Intelligence links retain their exact chat identity.

**Affected files:** `src/lib/mind/app-location.ts`, `src/components/mind/command-app.tsx`.

**Regression / evidence:** `scripts/adrian-audit-client-ui.test.mjs`, `src/lib/mind/adrian-analysis-regressions.test.ts`, `src/lib/mind/app-location.test.ts`.

### G05 Build editor

**Findings:** AA-009, AA-010.

Debug availability derives from actual host capability and preserves dirty/busy/halt guards. Unsupported web Debug is disabled with a reason. Editor uses semantic theme colors; empty result strip is not rendered.

**Affected files:** `src/lib/mind/kimi/ide-capabilities.ts`, `src/lib/mind/kimi/ide.server.ts`, `src/components/mind/code-ide.tsx`, `src/components/mind/gpt-shell.css`.

**Regression / evidence:** `scripts/adrian-audit-build.test.mjs`.

### G06 Library destinations

**Findings:** AA-011, AA-012, AA-013, AA-014.

Uploads bind to visible Library project or All files. Preview belongs to current selection. Drive Library imports save text rather than stage a chat send. Account changes/dismissed requests reject late results; signed-out Library upload stops before reading the file. Notices distinguish added copy from verified account sync.

**Affected files:** `src/components/mind/command-app.tsx`, `src/components/mind/media/cloud-picker.tsx`.

**Regression / evidence:** `scripts/adrian-audit-client-ui.test.mjs`.

### G07 Schedules

**Findings:** AA-015, AA-016.

Scheduler starts only after auth and workspace readiness and re-registers with the current owner/updater. Time-zone layout has a useful minimum width and responsive columns.

**Affected files:** `src/components/mind/command-app.tsx`, `src/components/mind/gpt-shell.css`.

**Regression / evidence:** `scripts/adrian-audit-client-ui.test.mjs`, `src/lib/mind/schedule-clock.test.ts`, `src/lib/mind/schedule-worker.test.ts`.

### G08 MCP approvals and cancellation

**Findings:** AA-017, AA-018, AA-019, AA-025.

Capability fingerprints include full tool schema and descriptive meaning. Changed capability requires fresh review. Complete schema constraints are validated; dismissed panels ignore late results. Halt/disable is rechecked after initialization immediately before dispatch. Lazy Notion token loading avoids unrelated database startup for other tools.

**Affected files:** `src/lib/mind/custom-connection.ts`, `src/lib/mind/custom-connection-fns.ts`, `src/lib/mind/mcp/call-contract.ts`, `src/lib/mind/mcp/registry.ts`, `src/lib/mind/mcp/tools.ts`, `src/lib/mind/connected-mcp.server.ts`, `src/components/mind/custom-connections.tsx`.

**Regression / evidence:** `src/lib/mind/audit-connection-integrity.test.ts`, `src/lib/mind/custom-connection.test.ts`, `src/lib/mind/connected-mcp.test.ts`, `src/lib/mind/mcp/registry.test.ts`.

### G09 Current context permission

**Findings:** AA-020, AA-021, AA-022.

Saved notes are selected after asynchronous preparation and checked again immediately before dispatch. Owner, halt and permission changes stop stale requests. Recovery checks the original receipt without replaying saved memory. Per-send context notice distinguishes history, saved notes, bot knowledge and personality.

**Affected files:** `src/lib/mind/context-permission.ts`, `src/lib/mind/context-budget.ts`, `src/lib/mind/logic-routes.ts`, `src/components/mind/command-app.tsx`.

**Regression / evidence:** `scripts/adrian-audit-deliver-lifecycle.test.mjs`, `src/lib/mind/adrian-analysis-regressions.test.ts`.

### G10 Durable stop and Build lifecycle

**Findings:** AA-023, AA-024, AA-026.

Durable halt cancels queued owner Build jobs and requests running-job cancellation even with Build unmounted. Planning aborts and late data is ignored. Local stop, server-confirmed halt, requested cancellation and confirmed completion remain distinct.

**Affected files:** `src/lib/mind/halt.server.ts`, `src/lib/mind/pc-pairing/store.ts`, `src/routes/api/mind/pc/result.ts`, `src/lib/mind/kimi/build-lifecycle.ts`, `src/components/mind/build-workspace.tsx`, `src/components/mind/command-app.tsx`.

**Regression / evidence:** `scripts/adrian-audit-build.test.mjs`, `src/lib/mind/halt-file.test.ts`, `src/lib/mind/pc-pairing/pairing.test.ts`.

### G11 Workspace reconciliation

**Findings:** AA-027, AA-028, AA-029, AA-030.

Retry loads a current snapshot/revision, three-way merges field changes against the actual base, preserves concurrent records and handles storage events for all collections. Conflicting fields in server synchronization require a choice bound to the exact local candidate and server revision; this does not claim an interactive conflict-review flow for ordinary same-browser storage events.

**Affected files:** `src/lib/mind/sync.ts`, `src/lib/mind/workspace-edits.ts`, `src/lib/mind/use-mind-workspace.ts`.

**Regression / evidence:** `src/lib/mind/workspace-reconciliation.test.ts`, `src/lib/mind/workspace-hook-lifecycle.test.ts`, `src/lib/mind/use-mind-workspace.test.ts`, `src/lib/mind/sync.test.ts`.

### G12 Attachment integrity

**Findings:** AA-031, AA-032, AA-033, AA-034, AA-035.

Images upload to owner-scoped account storage and are independently read back before portable references replace bytes. Oversize failure preserves the local original. Other devices can hydrate verified references. Missing bytes and incomplete archive manifests are explicit; unowned legacy cache fallback is removed.

**Affected files:** `migrations/0017_c4_account_attachments.sql`, `src/lib/mind/media/account-attachments.server.ts`, `src/lib/mind/media/attachment-integrity.ts`, `src/lib/mind/media/blob-store.ts`, `src/lib/mind/use-mind-workspace.ts`, `src/lib/mind/workspace.ts`, `src/components/mind/message-body.tsx`, `src/components/mind/command-app.tsx`.

**Regression / evidence:** `src/lib/mind/media/attachment-integrity.test.ts`, `src/lib/mind/persistence-incremental.test.ts`, `src/lib/mind/media/blob-store.test.ts`, `src/lib/mind/adrian-analysis-regressions.test.ts`, `src/components/mind/message-rendering.test.ts`.

### G13 Context selection

**Findings:** AA-036, AA-037, AA-038.

One client/server context selector replaces repeated last-12 truncation, retains early constraints and recent turns, reserves response space and provides omission counts. Conservative application ceilings differ for local/custom/free routes; they do not claim verified advertised upstream capacities.

**Affected files:** `src/lib/mind/context-budget.ts`, `src/lib/mind/logic-routes.ts`, `src/lib/mind/retry-fidelity.ts`, `src/lib/mind/media/history.ts`, `src/lib/mind/limits.ts`, `src/lib/mind/turn.server.ts`.

**Regression / evidence:** `src/lib/mind/adrian-analysis-regressions.test.ts`, `src/lib/mind/logic-routes.test.ts`, `src/lib/mind/media/history.test.ts`, `src/lib/mind/retry-fidelity.test.ts`.

### G14 Streaming and send recovery

**Findings:** AA-039, AA-040, AA-041, AA-042, AA-061.

Partial replies checkpoint by operation and remain incomplete across reload/export. Stop/retry checks a read-only receipt, including after sign-in, and never silently creates a new execution. Parsing handles CRLF, UTF-8 splits, terminal DONE and errors consistently; cancellation cannot hang on an upstream reader.

**Affected files:** `src/lib/mind/partial-reply.ts`, `src/lib/mind/live-turn.ts`, `src/lib/mind/stream.ts`, `src/lib/mind/relay.ts`, `src/lib/mind/turn-receipt.ts`, `src/lib/mind/turn.server.ts`, `src/lib/mind/transcript.ts`, `src/lib/mind/workspace.ts`, `src/components/mind/command-app.tsx`.

**Regression / evidence:** `scripts/adrian-audit-deliver-lifecycle.test.mjs`, `src/lib/mind/adrian-analysis-regressions.test.ts`, `src/lib/mind/stream-integrity.test.ts`, `src/lib/mind/live-turn.test.ts`, `src/lib/mind/relay.test.ts`.

### G15 Execution receipts

**Findings:** AA-043, AA-044, AA-045, AA-046.

Returned usage, request IDs, actual model and execution location survive adapters and client persistence. Failed/interrupted attempts retain known metadata and unknown values stay unknown. Rejected pre-dispatch requests do not count as primary executions. Helpers have stable child receipts and survive final-answer failure; repeated recovery deduplicates them. Recent usage remains explicitly bounded, not a billing/lifetime-total claim.

**Affected files:** `migrations/0018_c4_model_execution_receipts.sql`, `src/lib/mind/provider-receipt.ts`, `src/lib/mind/provider-call.ts`, `src/lib/mind/logic-route-adapter.server.ts`, `src/lib/mind/ai-provider-config.server.ts`, `src/lib/mind/model-consult.ts`, `src/lib/mind/model-execution.server.ts`, `src/lib/mind/execution-response.ts`, `src/lib/mind/execution-receipt.ts`, `src/lib/mind/execution-usage.ts`, `src/lib/mind/turn.server.ts`, `src/lib/mind/workspace.ts`, `src/components/mind/command-app.tsx`, `team/provider_router.py`.

**Regression / evidence:** `src/lib/mind/provider-receipt.test.ts`, `src/lib/mind/custom-provider-receipt.test.ts`, `src/lib/mind/persistence-incremental.test.ts`, `src/lib/mind/stream-integrity.test.ts`, `src/lib/mind/adrian-analysis-regressions.test.ts`, `scripts/adrian-audit-deliver-lifecycle.test.mjs`, `team/test_provider_router.py`.

### G16 Local search

**Findings:** AA-047, AA-048, AA-049, AA-050, AA-051, AA-053, AA-066.

All matching messages are independently reachable. Normalized/reordered keywords and quoted phrases use deterministic title/content/recency ranking and match-centered excerpts. Schedules, connection metadata, browser records, reports, visible deployment records and activity have stable destinations. Pinning has a visible pressed-state action and Alt+P. Search memoization depends on searchable collections, not usage-only changes.

**Affected files:** `src/lib/mind/palette.ts`, `src/components/mind/command-app.tsx`, `src/components/mind/fleet-panels.tsx`, `src/components/mind/bot-builder.tsx`.

**Regression / evidence:** `src/lib/mind/adrian-analysis-regressions.test.ts`, `src/lib/mind/palette-label.test.ts`, `scripts/adrian-audit-client-ui.test.mjs`.

### G17 Accessible actions

**Findings:** AA-052, AA-054, AA-055, AA-056.

Queue removal is a native named button. Blocking reviews use Radix modal semantics with Escape, background isolation and connected-opener restoration. Shortcuts reflect platform and hide on coarse pointers. A stable polite atomic region announces lifecycle milestones without token-by-token chatter.

**Affected files:** `src/components/mind/command-app.tsx`, `src/components/mind/modal-overlay.ts`, `src/components/mind/gpt-shell.css`.

**Regression / evidence:** `scripts/adrian-audit-client-ui.test.mjs`.

### G18 Canonical identity

**Findings:** AA-057, AA-058, AA-059, AA-060.

One verified identity endpoint backs UI and server operations. Conflicting authorities fail closed with an explicit session-ending recovery action. Pending auth cannot load a guest/private workspace. Popups bind origin/window/transaction and wait for confirmed old-session cleanup. Owner-scoped drafts recover after canceled/failed switching without restoring revoked credentials.

**Affected files:** `src/lib/auth/client.ts`, `src/lib/auth/popup.server.ts`, `src/lib/auth/popup-message.ts`, `src/lib/auth/session-user.ts`, `src/lib/auth/session-state.ts`, `src/lib/auth/session-http.ts`, `src/lib/auth/use-current-user.ts`, `src/lib/auth/verify.server.ts`, `src/routes/api/mind/session.ts`, `src/routeTree.gen.ts`, `src/lib/supabase/actions.ts`, `src/lib/mind/use-mind-workspace.ts`, `src/components/mind/command-app.tsx`.

**Regression / evidence:** `scripts/adrian-audit-voice-auth.test.mjs`, `scripts/sign-out-plan.test.mjs`, `src/lib/auth/session-user.test.ts`, `src/lib/mind/workspace-hook-lifecycle.test.ts`, `scripts/adrian-audit-client-ui.test.mjs`.

### G19 Rendering performance

**Findings:** AA-062, AA-063, AA-064.

Historical prose/code parsing is memoized; stream UI updates batch to animation frames. All historical DOM remains mounted and accessible for find/focus/selection. The real React DOM fixture measures repeated work at 20/200/1,000 messages; it does not establish a bounded mounted DOM or production/device latency. Conditional variable-height virtualization remains a separate proposal requiring representative full-application measurements and navigation/selection/accessibility design. Full workspace serialization for the size statistic runs only when Settings/Data is open.

**Affected files:** `src/components/mind/message-body.tsx`, `src/components/mind/command-app.tsx`, `scripts/profile-c4-history.mjs`, `scripts/profile-c4-render-counts.mjs`.

**Regression / evidence:** `src/components/mind/message-rendering.test.ts`, `scripts/profile-c4-history.mjs`, `docs/audits/c4-evidence/react-dom-profile.json`, `docs/audits/c4-evidence/render-counts.json`.

### G20 Incremental persistence

**Findings:** AA-065.

Snapshot saves upsert only changed records and delete only removed owner records inside the existing transaction/CAS contract. The isolated SQL fixture verifies that renaming one conversation does not rewrite unrelated collections and that a failed final snapshot update rolls back preceding row changes.

**Affected files:** `src/lib/mind/store.ts`, `src/lib/mind/server.ts`, `src/lib/mind/persistence-incremental.test.ts`.

**Regression / evidence:** `src/lib/mind/persistence-incremental.test.ts`, `src/lib/mind/store.test.ts`.

## Integration dependencies and gates

- Apply the two additive migrations only in the later authorized integration/release: `0017_c4_account_attachments.sql` and `0018_c4_model_execution_receipts.sql`. Reconcile numbering with other branches before any migration has shipped. Do not replace an already applied migration body.
- Attachment storage is owner-keyed in the existing database. New `acct_` references require the server storage code and migration together. Failed uploads preserve local bytes. Retention/quota and live device transfer remain release checks.
- Preserve receipt identity across reconnect/reload: no fresh Notion append on verification retry; no chat POST on recovery; helper receipt IDs remain children of the original operation.
- `command-app.tsx`, `server.ts`, `turn.server.ts`, `workspace.ts`, `types.ts`, auth/session files, provider adapters, Build/halt files, test registration and CSS overlap likely work from other audit chats. Resolve behavior as well as textual merge conflicts.
- `package.json` registers every new typed regression and the script glob discovers the new mounted-callback fixtures. Test concurrency is bounded for the large fixture suite; the sharder parser accepts that explicit flag without silently dropping tests.
- Per-model advertised context capacity (AA-037) needs trusted server-side profiles/discovery and an output-reserve policy before increasing conservative ceilings. The current defaults never claim full vendor window support.
- Long-term totals/retention (AA-045) require a product/privacy retention choice. The implemented UI calls its 200-entry list recent attempts and does not represent it as a lifetime billing ledger.
- Later authorized release gates: complete CI/build on the final integration SHA; isolated migration rollback/CAS verification; actual authenticated reconnect/session switching; live provider receipt matching; physical microphone/playback/assistive-technology and mobile checks. Do not infer these from fixture successes.
