# GrokBuild status

Updated on branch `feat/grokbuild-full-system-implementation`. This is the living status. It does not replace `.handoff/MANUS_RELEASE_2026-11-10.md` for merge and deploy.

| Subsystem | Status |
|---|---|
| EVE visible figure | Implemented. Original Three.js body plus photograph. Not a licensed face rig. |
| Facial motion | Blink, gaze, head, breath, jaw visemes. Geometric eyes stay hidden under the photo. |
| Lip sync | MPEG uses the audio clock. Live PCM is 55 ms per letter. Not sample-accurate. |
| Five characters | EVE, Liora, Iris, Luna, Aurora. Capacity 10 female / 10 male. Empty slots empty. |
| EVE Workbench | Local fleet controls are real. Paperclip stays not connected without its four env vars. |
| Emergency stop | Server-enforced. Pauses schedules. Clearing it does not re-enable them. |
| Routing A/B/C/D | Implemented in `src/lib/mind/routing-modes.ts`. A sends one model. B, C, and D send only the selected ready Astra/Sol/Luna routes and keep every reply. Unready routes block the send. No merge call is made. |
| Direct / Orchestrator | Existing toggle. Orchestrator fan-out is still not wired. Send stays on Direct and says so. |
| Response rating | 1–5 stored locally with the message id, model, and routing mode. One rating is not treated as proof of quality. |
| Voice | Profile follows the character. Audible speech needs an existing key. None was spent. |
| Adrian Core worker | Exits 2 with no database. Refuses the two forbidden Supabase refs. Does not call models. |
| Notion, GitHub, Drive, RAG, browser, Tauri, iPhone | Not newly completed. Existing routes stay. Live calls stay blocked without owner credentials. |
| Production | Not deployed. |

Do not describe B, C, or D as a merged expert answer. They are separate real calls, or a block when the routes are not ready.
