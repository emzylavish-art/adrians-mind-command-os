# Product reality — 2026-11-11

This is evidence from this pass. It is not a claim that Adrian OS is complete.

## Source

- Branch: `feature/adrian-build-kimi-hosted`
- Last committed SHA before this pass: `c37a06893e96fc43f5d20738852ebb89f04a4c58`
- `origin/main`: `0f08b03`
- The deep product mandate is stored as source material in `docs/ADRIAN_OS_DEEP_PRODUCT_MANDATE.txt`. Storing it does not implement it.

## Live site

- URL inspected: `https://adrians-mind.vercel.app`
- The signed-out browser session reached Chat and Build. Voice and connected services showed a Sign in link.
- Chat showed Grok configured, database remote configured, Notion status unknown, Companion not paired, and REA partial.
- The Build navigation opened the older empty state: “This page does not edit the repository” and “Local Companion not paired.” That copy is not in this branch. This branch mounts `BuildWorkspace` when the Build view is selected.
- The fixed Speak control and signed-out card covered the last lines of the page. The module scroller now keeps bottom padding so those controls do not hide the last content.
- No production SHA was present in the response headers. A Git push is not treated as a deploy.

## What this pass changed

- Effort picker sits on the send row in both composers.
- Conversation style sits on the send row and still only changes tone.
- Orchestrator still does not fan out. Text send stays on Direct. The picker also switches the existing voice route, which falls back to Direct when no computer is paired.
- Approved Companion shell jobs are dispatched to the worker that already handles shell.
- Build no longer says nothing can run when the Companion is offline. Submit attempts the hosted runtime and must show that runtime’s real result.
- Registered projects can be opened and archived through the existing project API. Saved sessions can be renamed through the existing session API. Neither action claims the workspace path is reachable.

## Not verified

- Owner sign-in on this browser session.
- Production deploy of this branch.
- Production database migration `0008`.
- A Kimi coding task. The local CLI can open a session, but the subscription does not include Kimi Code.
- Saved provider keys are still not injected into Kimi. The UI still says so.
- Notion, Gmail, voice realtime, Git push, and a signed-in production walkthrough.
