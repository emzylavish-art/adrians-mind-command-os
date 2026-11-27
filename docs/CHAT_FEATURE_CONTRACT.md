# Conversation surface contract

This boundary implements the first contained extraction for C3 AA-249 and AA-255. `ChatPane` renders the current conversation. The command session retains account ownership, persistence, provider dispatch and authorization. Shared composer/provider/voice controls are in `chat-controls.tsx`; display formatting and product marks are in `chat-presentation.ts`.

## Inputs and outputs

`ChatPane` has an explicit TypeScript prop contract. Its inputs are the already scoped active conversation and conversation list, draft and attachment state, provider/model choices, memory choice, tool progress, receipts, and operation callbacks. It does not discover credentials or infer account ownership from a conversation ID.

The component emits user intent through callbacks. Sending, retrying, stopping, exporting, changing a provider, changing memory, regenerating an answer, and editing an image are all delegated to the session. The asynchronous edit callback returns `Promise<boolean>`; the edit form closes only after the owner accepts the new branch. The component does not represent an optimistic local removal as a server acknowledgement.

## Account and authorization boundary

The session supplies resources belonging to the verified account. `CommandApp` mounts the session inside an account-keyed `SurfaceErrorBoundary` and `AccountPreferencesProvider`. An account change unmounts the previous session and its presentation state. Image descendants use that same owner context for local blob access.

Controls may be disabled while busy or halted, but a disabled control is not an authorization check. Server handlers continue to enforce owner identity, memory suspension, provider selection, approval scope and persistence revisions. `ChatPane` must never import server modules, load credentials, dispatch a provider directly, or mutate a workspace independently of its callbacks.

## Lifecycle and persistence

The component owns only presentation state: filtering, expanded menus, copy feedback, edit text, transcript position and the visible message window. Its transcript `ResizeObserver` disconnects on cleanup. The listening timer is cleared when listening stops or the component unmounts. Switching the active conversation resets the message window and dismissed-message set.

Workspace data, draft persistence, media originals, memory, provider settings, and pending operations remain with the session and their dedicated stores. Shared controls are controlled components: choosing an option invokes the supplied callback and does not save a setting themselves.

Direct browser actions are user-requested clipboard copying and downloading a reviewed comparison document. Failed or unavailable clipboard access produces visible feedback. Provider and persistence errors arrive as scoped props or message receipts; a rendered status does not establish a live provider connection.

## Behavior preserved by extraction

The extraction checkpoint retained the exact declarations for `ChatPane`, its shared controls, `chatBucket`, `stamp`, and product marks, adding only export modifiers. The original declarations were removed from the shell. Subsequent scoped feature additions mount the comparison panel and voice-stage receipt; the extraction equivalence receipt does not claim that those later additions existed in the earlier source. The following intended behavior stays covered by the normal test runner:

- The Command and Message composers each retain one toolbar and one Send control. Stop remains actionable while a generation is active, and empty submissions are disabled.
- Chat memory controls and saved-memory indicators remain mounted; a completion without a save receipt does not acquire one.
- Voice mode and mute controls, tool progress, provider attribution and shared failure-banner wiring remain present.
- The account session remains the operation owner, and service authorization tests retain their separate runtime fixtures.

Characterization tests read the module that owns each surface after extraction: `scripts/navigation-drawer.test.mjs`, `memory-mount.test.ts`, `visual-polish-contract.test.ts`, and the integration voice, security and persona suites. Existing behavior tests for routing, context, transcript edits and memory continue to exercise the delegated handlers. A whole-repository TypeScript check validates the extracted prop and import boundary.

This extraction does not claim that the remaining command session has been fully decomposed. Future feature extraction should establish the same ownership, lifecycle and side-effect contract before moving another coherent responsibility. Browser interaction, authenticated account changes, provider calls and production deployment remain separate verification scopes.

## Investigation comparison

`ConversationComparison` receives only the current account's conversations and a navigation callback. It keeps its review locally in mounted component state; it makes no provider request and does not save a new chat or mutate the sources. Temporary conversations and unfinished/error outputs cannot become source evidence. An explicit download exports only the reviewed blueprint.

Every included passage retains its conversation ID, message ID, selected answer-version ID when present, exact character range, provider/model attribution and source text. Export revalidates those source fields against the current workspace. Deleted, changed or switched-version sources require rebuilding the review instead of silently copying stale evidence.

Duplicate detection means exact text, preserving indentation-sensitive code. Disagreements are differing positions assigned by the owner to the same decision topic; no semantic conflict detector or automatic resolution is claimed. Source text starts unreviewed. An owner-confirmed label requires a supplied evidence note and remains clearly distinct from independent verification. The blueprint preserves hypotheses, proposals, conflicting positions and outstanding verification tasks. The six-conversation/120-passage bound produces an explicit error rather than truncating findings.

## Architecture regression gate

Run `node scripts/frontend-architecture.mjs` for the current report. Its normal-runner regression tests also check the actual checked-in boundary against `scripts/frontend-architecture-baseline.json`.

The report counts static and lazy runtime imports, direct feature areas, actual React hook call expressions, lifecycle effects, references, source size and largest function size. Type-only imports, comments and text examples do not add runtime coupling. New feature areas, substantial growth beyond reviewed limits, a reverse chat-to-shell import, a tracked module cycle, or direct service/persistence imports into presentation produce a failed review. Smaller dependency additions appear as review signals.

These measurements are direct-dependency and maintainability checks, not a security proof or a complete transitive dependency audit. The test suite includes a same-line synthetic addition of several feature dependencies so coupling can fail even when source line count stays constant. Changes to a baseline require inspecting the new responsibility and documenting its ownership; the script never raises its own limits.
