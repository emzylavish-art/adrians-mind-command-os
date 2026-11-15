---
name: adrian-os-builder
description: Continue Adrian OS on the local preview without deploying or claiming it is complete. Use when the user asks to keep fixing Adrian OS, execute raw materials, prove Chat, Build, Intelligence, EVE, Speak, or Eve's live projection, or continue emzylavish-art/adrians-mind-command-os.
---

# Adrian OS builder

Continue the product. Do not deploy, do not push, and do not say it is complete.

## Where the work is

- Repo: `/home/ubuntu/adrians-mind-command-os`
- Preview: `http://127.0.0.1:8080`
- Restart from the repo: `npm run dev -- --host 127.0.0.1 --port 8080`
- Hosted files: `.data/adrian-build-workspace`, also stored in `mind_kimi_file` for the loopback account `dev-user`
- Coding home: `.data/adrian-build-home`
- Proof images: `/home/ubuntu/adrians-mind-command-os/proof`
- Raw materials: `/home/ubuntu/upload/Pasted_content_62.txt`
- Question blueprint: `/home/ubuntu/upload/Pasted_content_92.txt`

Confirm the preview answers before changing UI. If port 8080 is down, restart it. A quiet Vite process is healthy if `curl` returns 200.

## Hard stops

- Do not open Vercel, deploy, or treat a git push as a deploy.
- Do not print `XAI_API_KEY`, management keys, or other secrets.
- Slack stays off. Leave Astra, Sol, and Luna out unless their keys are connected.
- Use only saved keys. Do not ask for passwords.
- Do not commit docs dumps, lockfiles, caches, submodules, or secrets.
- Do not claim a carrier phone call unless a handset call was actually placed. The in-app Speak call is a separate proof.

## Each fix

1. Change one product gap in the existing surfaces. Do not replace the working preview stack.
2. Prove it in Chromium with Playwright at `/usr/bin/chromium`, headless, `--no-sandbox`.
3. Capture desktop at 1280x800. Capture phone at 390x844 when the change is layout.
4. Reply in English with what changed, the proof path, and what is still unproven.

## Coding runtime

- Build runs the cloned Kimi process with Kimi login stripped and the saved Grok key. The coding model is grok-4.7.
- File writes stay inside the hosted workspace. Secret and `.git` paths are refused.
- A hosted write must also land in `mind_kimi_file`. After a process restart, listing files restores them from that table. `/tmp` is not durable.
- Human Code discusses. Execution and diffs go through Build.
The coding conversation is labeled Intelligence in the product. Do not show the name Human Code. Saved threads may still carry the old internal marker. The main pane is grouped into Threads, Files, Discussion, Actions, Lines, and Message. Do not put those controls back into one stack. The sidebar and top bar stay as they are.
- Plugins, Build, and Settings use the same main-pane groups. Do not flatten them back into one stack. Plugins keeps Grok and Voice in Connected, and the Kimi plugin links stay real links. Do not remove a connected service to make the page look cleaner.
- The IDE is `src/components/mind/code-ide.tsx`: file tree, tabs, and CodeMirror. Do not put the hosted editor back into a textarea.
- Complete uses the project's TypeScript language service. Debug pauses a hosted JavaScript file with Node's inspector and shows the paused line and locals.

## Surfaces that must keep working

- Chat sends through the round Send button and returns a Grok reply.
- Search opens a Human Code thread in the code view, not as a normal chat.
- EVE can open or resume a Human Code thread.
- Speak keeps Eve, Storyteller, and Unhinged. Place call speaks a phrase, transcribes it, asks the model, and speaks the reply. That is the in-app call, not a carrier call.
- EVE has an original portrait at `public/brand/eve-idle.jpg`, generated with the saved model key. She appears on the EVE surface and on the Speak call. She is labeled AI. Do not replace her with a copied reference photo.
- Asking EVE or finishing a Speak call writes a PROPOSED or EXECUTED row in `mind_receipt`. Show the row. Do not invent a receipt that was not stored.
- The IDE spans the main pane. The sidebar does not scroll. Recent chats scroll in the chat pane.
- Agent OS Skills includes Adrian OS builder. Running it shows this process. Coding turns include the same standing order.

## Question blueprint

When the owner says to do unfinished work from `/home/ubuntu/upload/Pasted_content_92.txt`, work the highest-priority unproven product gap. Do not write a long status dump instead of the fix. Record only the evidence needed to resume. A question is not PASS without the proof level it asks for.

## Later blueprints

Question blueprint: `/home/ubuntu/upload/Pasted_content_92.txt`. Audit blueprint: `/home/ubuntu/upload/Pasted_content_93.txt`. Inspect and fix the running preview. Do not replace that work with an inventory dump. Do not deploy.
Finalization blueprint: `/home/ubuntu/upload/Pasted_content_94.txt`. Do not mark it closed. A named gap is closed only when the preview shows the working control.

The call hides the app while it is open. Speak shows the saved `eve-idle.jpg` face and cannot press the emergency stop. The live turnable stage stays on Intelligence. Plugins keeps the working Kimi connection and does not remove Grok, Voice, or any other connected service.
Visible labels say Intelligence, not Human Code. Saved threads may still use the internal marker. Eve on the Intelligence layer is the turnable stage. Dragging her must change the angle of the body and the face together. Do not put the chat behind that stage.
The Build workspace label must show the durable `.data/adrian-build-workspace` path. Do not show `/tmp/adrian-build-workspace`. A stored project with that old path is rewritten on read.
Unconnected plugins stay behind Show. When shown, they are category groups with search, not one flat list. Custom MCP stays in Kimi links. Do not put scheduled jobs inside the Settings connector group. Do not add citation tabs that were not visible on a reference site.
Answer, Links, and Images are allowed on a reply because those tabs were visible on Perplexity. Show only links and images that are in that reply. Do not invent sources.
The phone drawer covers the page. Its groups are Work and Connect. More stays closed until opened.
EVE's face is `public/brand/eve-idle.jpg`. Do not use `public/characters/eve` plates for her. Those plates are a different person. The body is the clothed female rig in `src/lib/mind/avatar/human-rig.ts`: narrower shoulders, a waist, and hips wider than the waist. Do not put the box torso back. Do not mark a blueprint question PASS unless the preview proof matches the level that question requires. The Windows delivery blueprint at `/home/ubuntu/upload/Pasted_content_95.txt` is stored only. Do not start a desktop build until the owner says execute.
When the owner talks to EVE, memory stays on and she receives the workspace note from `eveAccessNotes`. That note may list chats, projects, files, agents, connections, and schedules. It must not include secrets. She cannot turn the emergency stop on, clear it, or bypass it. The owner still owns that button.
The closed blink is painted on `eve-idle.jpg` at the measured iris points and must use the same gaze shift as the crop. A lid that leaves either iris visible is not a blink. The turning shoulders must stay behind the face. Answer, Links, and Images are visible on a reply that actually contains that link or image. Do not close the audit or finalization blueprint from a local screenshot of one control.
Mouse, keyboard, and browser-pointer control are not built. A spoken request for them must refuse when no computer is paired or the emergency stop is on, and must stay a proposal when a computer is paired. Eve cannot approve it or press the stop. The only paired actions today are file_read, file_write, file_delete, and terminal, each after the owner approves the exact action. Build on the website uses the hosted workspace and does not need a Windows install. In-tab recording can continue after Speak closes. Do not claim it continues after the browser closes or on the laptop outside this tab.
The owner flow is `data-testid="owner-flow"` on Intelligence and Build. It lists only file read, file write, file delete, and terminal. Run stays disabled until the stored approval string equals that exact action. Approving file write does not approve file read, delete, or terminal. The emergency stop blocks all four. Those four run in the hosted workspace only. Windows desktop software is not built and must not be created unless the owner explicitly says to turn it into software. The same screen opens Speak, shows the in-tab recording, and keeps the stop owner-only. Recording ends on pagehide and beforeunload. It cannot continue after the tab closes. Label mouse, keyboard, browser pointer, files on the Windows PC, and microphone after the browser closes as cannot run.
Typing in Ask EVE calls `projectFromSpeech` before any model reply. It changes the stage background and the `eve-projection` panel on her own computer. The panel must say the Windows desktop was not changed. Do not treat that color change as mouse, keyboard, or PC control.

## Cost

Do not spend a turn reporting status. Do not re-read the pasted blueprint. Do not re-prove Speak, recording, the owner stop, or the four hosted actions unless the change touches them. Do not spawn agents unless the owner asks for a fleet. Do not call a model. Do not deploy, push, or buy anything. The dress ends at the hips. The tapered legs and shoes stay visible. Do not hide them behind a column. The figure is still not a finished sculpt. The closed blink covers both irises at canvas 186,174 and 352,170. A full yaw of PI must show the back of the head, not a floating face plate. Section 28 is `proof/section-28.md` and was not in the original paste. A lower screenshot does not close a blueprint. The Agents page shared fleet uses `src/lib/mind/fleet`. One orchestrator, adrian-core, routes. Every bot has the same workspace memory and the same four actions. Do not give a bot a private brain, a secret, or the stop. Notes in `proof/adoption` are evaluation only. Do not install them. Hatchet stays blocked. Do not research LiveKit or Langfuse again unless the owner asks. Windows installer, desktop control, HyperFrames, a local model download, and production deploy stay blocked.
