# Adrian’s Mind OS Composer Queue

## Product goal

The Queue button in the reference solves a specific timing problem. A response is already underway, and the user has a second instruction that belongs after it. The composer should accept that instruction immediately and leave the current response and Stop action available. The visual design uses a pill the user can recognize, a queue count that opens a sheet, and transitions that give immediate feedback when a control is pressed. The same interaction belongs to Chat, the new-chat screen, and the shared Work and Build composer.

The queue has a distinct lifecycle from a submitted task. A queued draft has text and a position. A waiting Chat message has an eligible foreground reply to follow. A Build job has separately passed its existing execution controls and has a runtime identity or receipt. The interface names those different states so storing a prompt never looks like an external job has been accepted.

## What appears in each surface

| Surface | Queue entry point | Meaning after submission | How the user continues |
| --- | --- | --- | --- |
| Current Chat | Queue sits beside Send or Stop. Enter retains the composer’s existing busy behavior. | A plain-text message queued during an active reply waits for successful completion in that same foreground conversation. A message queued while idle is held for review. | Open the count and move a held item to the composer. Review the destination, model and content before using Send. |
| New Chat | Queue sits next to the Home composer’s Send control. | The prompt is stored with the account’s new-chat draft scope for this tab. The queue action leaves the workspace on Home. | Recover an item to an empty composer and choose the normal send path to create its new conversation. |
| Work and Build task composer | Queue sits with Ask Build, Review Build or Run Build. The same queue controls are also reachable from the editor and status navigation. | The task is held in the selected project. A running coding job and its receipt remain separately visible and controlled. | Move a task to the composer. Check the selected workspace, files, branch, mode and any required approval. Use the existing explicit submission action when ready. |
| General Work | The Work and Build controls stay available when no project is selected. | General Work has its own queue scope. | Switch to a project or review the item in General Work as appropriate. |

A scoped queue holds eight drafts. Text is limited to 8,000 characters, matching the current Chat and Build text limits. A draft may carry a staged text excerpt and up to four prepared images. The composer keeps the source draft when the queue is full, an attachment is invalid, or browser storage refuses the move.

## Queue management

1. **Open and orient.** The count button has the scope and number waiting in its accessible name. The sheet identifies whether the user is looking at new-chat, conversation, or Work and Build prompts. An empty state shows up when the last item leaves. The capacity text shows how much space remains.
2. **Scan the sequence.** Each entry shows the actual saved text and its position. The queue distinguishes waiting, held for review, and dispatch started. Long text is bounded and scrollable inside the row. Identical text can represent separate messages, so the queue uses stable item IDs.
3. **Change priority.** Move up and Move down are ordinary keyboard- and touch-operable buttons. They disable at the relevant boundary. Reordering changes relative positions without replacing unrelated rows or sending a request.
4. **Edit.** Edit opens an inline textarea with the existing words. In Chat, entering edit mode places waiting messages on hold so a reply cannot consume the row during a mid-edit state. Save requires non-empty text and retains the message identity. Cancel leaves the saved item intact.
5. **Hold and reconsider.** Hold waiting messages disarms the queued Chat continuation without stopping an already-active response. Held items stay available to review after a stop, provider failure, reload or switch away. Existing Stop still acts on the active reply.
6. **Return to the composer.** To draft is available only when the destination composer has no unrelated text or attachments. It transfers the exact item back to the right entry point. A Work or Build restore opens the Task section and focuses the text field for review.
7. **Remove.** A visible Remove button names its position to assistive technology. Removal has a narrow scope and leaves the other rows in order. A dispatch-started notice has a separate dismissal label and provides direction to inspect the conversation.
8. **Recover after interruption.** A Chat claim records that dispatch started before the existing send path runs. If a reload interrupts the handoff, the notice stays visible and blocks one-click reuse. The original conversation is the place to confirm the user turn and recover the reply. A known unsent failure returns its message to the held state.

## Identity, ownership and dispatch

The implementation builds on the existing conversation cue and account-scoped composer draft storage. The new-chat queue keys by owner and Home draft. Conversation queues key by owner, conversation and temporary status. Work and Build key by owner and project, with a separate General Work scope. The browser tab owns these queues. An ordinary reload in that tab can recover held text. Temporary Chat keeps its queue in memory. The existing account draft cleanup covers the persisted queue keys.

An automatic Chat continuation requires a successful reply from the same conversation, the same owner, the original project, an eligible runtime captured for that row, and the current foreground conversation. The queue performs the claim synchronously before invoking the existing conversation delivery path. Pending entries after an unsuccessful send stop at review. If the user changes the active surface or hides the page before completion, the row is held. A reload loses the in-memory authorization to continue. The provider selection and permission checks remain in the existing send path. Queueing gives the normal send path a message, with the same execution boundaries as a typed prompt.

Work and Build start with review. An ordinary Queue action keeps the draft for review. A user can approve one queued plain-text plan while an existing Grok plan runs. The foreground tab sends the exact text only after a successful predecessor and matching account, project and planning configuration. Coding jobs keep the explicit Run action.

Attached drafts wait for review, including when a Chat reply is active. The queue keeps prepared image data and the same staged excerpt the composer displays. It shows the attachment names and restores the draft only into an empty composer in its original scope. Slash commands and source-linked Build handoffs remain in their normal composer flow. The browser composer queue has no server worker.

## Motion, touch and accessibility

The design uses Adrian’s existing colors, typography, and modal behavior. The Queue pill and count use a 44-pixel minimum target. On a touch screen, the queue becomes a bottom sheet inset above the safe area. On a wide screen, it uses the existing centered review dialog. The content animates from a small vertical offset with a short eased entrance. Press feedback is a restrained scale change. The animation uses transform and opacity so it does not animate the transcript, the composer’s height, or the reading position.

Motion stops when the device requests reduced motion or the workspace preference is set to Reduce. The interface exposes every item action with native buttons and the sheet keeps focus contained. Escape and Close restore focus to the opener. Removing a queue entry never depends on a long press. Status and count changes are available to screen readers without announcing every streamed token. Visible focus, theme colors, wrapped action groups and bounded text make the same interface usable with a mouse, keyboard or touch.

## Implementation sequence and acceptance

| Step | Implementation | Acceptance condition |
| --- | --- | --- |
| 1. Establish existing behavior | Trace normal send, queued Chat delivery, current provider and owner gates, Work project selection and actual Build submission. | Existing Send, Stop and Build run paths remain reachable and keep their respective permissions. |
| 2. Extend queue storage | Reuse typed draft storage and sanitize queue records. Support ordering and phase recovery. | Blank, long, malformed and duplicate identities fail safely. Reload can recover scoped held text. An uncertain claim cannot automatically send again. |
| 3. Connect Chat | Provide visible Queue and a shared queue sheet. Advance only after a successful in-scope reply. | A controlled stream proves no extra send before the first completes, a single follow-up dispatch, and eventual disappearance from the queue. |
| 4. Connect Home and Work | Use the same component and review flow. Surface it near task actions and from the other Work panels. | Home restores drafts without creating a conversation. Project A and Project B recover distinct queues. Editing, moving and restoring a Work prompt produce zero Build submissions. |
| 5. Verify interaction | Exercise keyboard, Escape, phone viewport, reduced motion, editing, reordering, reload and normal nearby features. | The sheet keeps keyboard focus contained, restores it on close, and remains usable in the tested mobile layout. |
| 6. Verify the candidate | Run typecheck, architecture checks, the test suite and isolated browser fixtures. Preserve exact revision and redacted evidence. | Test reports distinguish synthetic provider replies and local browser recovery from hosted and physical device evidence. No SQL change is required for the composer storage. |

## Follow-on capabilities and required decisions

**Attachment recovery.** Temporary Chat keeps its queue in memory. A corrupt attachment record is held and any recoverable text can be returned to the composer for the user to reattach the file. Queuing a file retains the staged excerpt, through the same review and send flow as an ordinary composer attachment. The original library file and its download remain subject to their own scope and retention behavior.

**Cross-device recovery.** Save a held draft using Across devices and recover it for review in the same queue on another signed-in device. The server tracks one recoverable claim per saved copy. An armed planning follow-up stays in the original tab. Temporary conversations have no device-transfer action.

**Automatic Work planning.** Edit, remove, hide the tab or cancel approval before dispatch to hold the draft. Changing the project, planning tier, branch or editor buffers invalidates approval even if the user returns to the old configuration. The queue saves the operation ID before sending a model request. After an uncertain reply, **Check planning receipt** reads the recorded status without resending. A confirmed undispatched attempt returns the text to the held queue. Background coding execution still needs a persisted, verified runtime grant and is outside this planning path.

**Physical device verification.** Chromium’s 390-pixel mobile fixture tests narrow layout and reduced motion. A real iPhone keyboard and safe area, VoiceOver, and the installed Windows companion need their own checks. The Vercel production release remains subject to the existing isolated hosted verification gate.
