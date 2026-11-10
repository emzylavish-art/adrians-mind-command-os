# EVE Workbench and conversation styles

## Purpose

EVE is the primary operator interface for Adrian Core. The **EVE / Intelligence** destination does not replace Chat, Bots & Agents, Runs, Connections or the 3D Dashboard.

The Workbench shows saved workspace runs, events, browser-session records, files, schedules and agent deployment records. Controls call the existing local fleet. They do not invent activity.

## Controls that perform real local actions

- **Queue task** calls `enqueueRun` for a saved agent. It refuses when the emergency stop is on or no agent exists.
- **Pause, resume, cancel** call the fleet transitions. A control that cannot apply returns the actual reason.
- **Approve browser / Approve send** records approval on a run that is `waiting_approval`. Approval does not open a page or send mail by itself.
- **Step local worker** calls `tickFleet` once. Local reads can finish. Search, browser and mail stay `waiting_external` unless a real driver is attached.
- **Step saved server copy** runs one pass on the signed-in owner's saved server snapshot and writes it back. It does not replace the open browser workspace and does not call a model or Paperclip.
- **Emergency stop** is the existing owner control. Turning it on cancels open runs, pauses schedules, and writes the server halt. Clearing it does not re-enable schedules.
- **Pause / enable schedule** changes the saved schedule flag. It does not pretend the job ran.
- **Artifact** buttons download the stored text file.

## Paperclip, voice and characters

Paperclip status is the authenticated read-only bridge. If the owner, URL, key or company is missing, the panel says it is not connected. No agent is marked live.

Five adult female presentation identities are filled (EVE, Liora, Iris, Luna, Aurora). The roster is sized for ten female and ten male identities. Unfilled slots are empty. Characters share Adrian Core, memory policy and the emergency stop. They do not grant tools.

Direct voice sessions receive the active chat personality and the selected character. Orchestrator mode stays the silent speech-to-text prompt and does not speak. The digital human on this page uses original photographs and letter-timed visemes. It is not a rigged GLB. See `docs/DIGITAL_HUMAN.md`.

## Conversation styles

Styles are stored on each chat: Assistant, Professional, Storyteller, Playful, Romantic, Supportive, Unhinged and Custom.

Custom is trimmed, control characters are removed, and it is capped at 800 characters. It is presentation only.

## Not claimed

- A running Paperclip host.
- Paid model, voice, avatar, search or OAuth calls from these controls.
- Hosted always-on execution unless `DATABASE_URL` is set and `scripts/mind-worker.mjs` is actually supervised.
- Production deployment. That remains the Manus release step on project `adrians-mind`.
