# Chat, Speak and Build release plan

This follow-up starts from the combined website release at `4c07441c95cc17628757ef5d4f6260a6be78ac99`. PR #68 is already merged. The five chapter ledgers in this directory remain the source of finding IDs and historical evidence. This plan tracks the later reports against the live product. A row describes what a reviewer must be able to do. It does not certify a real provider call.

## 1. Read an answer and inspect its evidence

A text reply should be readable as soon as it appears. In the reported layout the user passed the version history, context outline, delivery label and three category buttons before reaching the first sentence. Put successful-response diagnostics below the answer in a single disclosure. Keep an incomplete reply, a failed delivery and its recovery controls visible.

| Situation | Interaction | Acceptance check |
| --- | --- | --- |
| Plain text | Read the reply directly | No empty Links or Images controls. Copy and Read aloud stay on one line inside their buttons. |
| Text with sources | Select Links | Show distinct HTTP destinations with their labels. Ignore links inside fenced code. Arrow keys move only through available sections. |
| Generated or attached image | Select Images | Include saved images and inline Markdown images. Preserve download, save, and supported edit actions. An unavailable historical image retains its name. |
| Regenerated reply | Expand Response details, then Answer versions | Select and compare versions. Changing versions must also update the available sections and keyboard selection. |
| Provider and tool details | Expand Response details | The actual model, context, helper results, voice stages and skill receipts remain inspectable. |
| Streaming or interrupted answer | Scroll, stop, copy received text, then resume reading | An interrupted response keeps its status. Reading an older message must not force the viewport to follow each token. |

Use a seeded long conversation on desktop, narrow portrait, landscape and 200% zoom. Measure the distance between the final message and composer and check that each action is reachable. Repeat with the mobile keyboard shown and dismissed. Capture the revision, browser, viewport, zoom method and whether the keyboard is simulated or physical.

## 2. Use one conversation through text or speech

1. Select an input engine, answer model and output engine. Record one utterance, retain the transcript, and submit it through the same owner-scoped message path as typed text. Show the provider and model actually used for the answer.
2. Select Orchestrator and multiple connected helpers. Use the same helper selection as chat. Confirm which helpers returned, which failed and whether synthesis completed. Never infer that a tool ran from a model saying it did.
3. Check the realtime xAI option separately. Its microphone transport can provide transcripts while the selected answer model handles the conversation. Starting a conversation with no existing thread must preserve the open call.
4. Interrupt output while text is arriving. Speaker mute should silence playback while preserving the text. End call, stop, navigation and account switching must release captured tracks and discard obsolete callbacks.
5. Add a photo during a call. Keep Speak open and display the attachment before submission. Preserve it if delivery fails. After success clear only what was sent, retaining anything added while the request was in flight.
6. Preview a camera or chosen screen. Attach a frame and ask a question about it using a vision-capable model. Test denied permission, stopped sharing and a source switch. An attached frame travels with the next submitted turn. Continuous provider video is a separate capability that needs an explicitly supported endpoint.
7. Verify a text-only model refuses unsupported image input clearly. Keeping the chosen model and retaining the user's attachment are necessary when changing providers would alter cost or privacy.

## 3. Use Build with a microphone and repository tools

| Task | Implementation and release check |
| --- | --- |
| Dictate a task | Focus the Build task field and start the existing dictation path. Let the owner edit the transcript before planning. |
| Discuss a plan | Open Speak from Build, attach an image, and ask for a plan. Route the result back to Build and play it using the selected voice stage. Preserve the task and newer attachments. |
| List repositories | Use the signed-in app owner's GitHub grant. Ask “Can you access my GitHub?” and inspect the returned repositories or the actionable connection error. |
| Read or change one file | Read with `/github read OWNER/REPO BRANCH PATH`. To update, use `/github update OWNER/REPO BRANCH PATH BLOB_SHA` followed by a newline and the full replacement. A changed revision must return a conflict. Check a disposable branch for the returned commit. |
| Separate planning and execution | A plan is a text reply. Show a write as successful only after GitHub returns the commit. Inspect branch history after a lost acknowledgment before retrying. |
| Use the owner's PC | Confirm the intended machine is paired and online. Browser screen access comes from a user-selected share. Terminal and file actions require a working device adapter. Exercise safe read and reversible file edit in an isolated workspace. |

Expand natural-language commands only where a real adapter can execute them. Each registered tool needs a schema, authenticated owner, required permissions and an operation result. Future API keys need a compatible adapter, capability detection, scoped storage and an actual provider check. Key acceptance alone cannot establish support for input audio, vision, tools, image generation or synthesis.

## 4. Recover image generation and dashboard activity

The reported image request failed while the hosted function tried to create a local rate-limit directory. Exercise the limiter on a read-only application directory and use the platform's writable temporary path for this per-instance cache. Durable spend authorization and duplicate-request protection must still operate. Send one approved minimal image request in Preview, check the returned image bytes, then open the image in the conversation. Test a provider rejection separately and check that it records no generated asset.

The dashboard graph must read real operation status. Verify empty, loading, failure and populated states. Trigger a test operation in the same account, wait for refresh and reconcile the displayed change with its actual event. Check that another account's activity cannot contribute to this graph. A polling response alone is insufficient evidence of correct values.

## 5. Verify Intelligence and voice cloning

Save the Nuance key in the encrypted owner-scoped store. Re-read it on the server before acknowledging the save. Reload the client, verify a different owner cannot use the grant and start one Sonia session. Observe permission, input audio, avatar video, output audio and provider session ID separately. Test double-click, denial, disconnect during startup, mute, hang-up and navigating away. An unavailable persona must reflect the provider response.

For coding Intelligence, verify that a task handed to Build retains its source thread, current draft and attachments. Verify any claimed repository change through the target branch. For cloning, check provider capability and profile storage separately. Test consent challenge, attestation, enrollment, generation, deletion and restart using an approved sample and durable profile store. A successful provider health check does not prove these operations.

## 6. Qualify and promote the combined release

- Compare the candidate with the actual production Git SHA. Record all CI jobs, individual skips and any lint findings. Run auth and architecture checks, TypeScript, unit and script suites, browser fixtures and a production build.
- Verify Preview points at an isolated destination within the existing infrastructure and that its app account, disposable GitHub branch, test Notion page, scheduler target and provider budget are approved. Keep provider secrets out of logs, screenshots and receipts.
- Exercise Gemini immediately after selection and after reload with fallback disabled. Separately test free-only OpenRouter where enabled. Capture the actual provider, model and redacted receipt. For each supported adapter, record which operation was tested.
- Confirm original-destination Notion retries, cancellation of a scheduled occurrence, queued memory/privacy enforcement, attachment recovery and independent voice stages still pass on the release SHA. Keep simulated layout evidence and physical device evidence separately labeled.
- Reconcile any SQL changes against applied migration checksums. Reuse the verified existing database; no new Supabase project is required by this change. Verify the migration gate and rollback target before changing a production alias.
- Promote the combined candidate only once, through the established Git/Vercel path. Verify the canonical hostname, READY deployment ID, exact SHA and safe read-only smoke checks. Keep a prior verified deployment available for rollback.
