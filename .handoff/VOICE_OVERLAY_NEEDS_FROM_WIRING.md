# Voice overlay needs from Voice Wiring

Date: 2026-11-01 (Africa/Lagos)
Lane: voice-integration
Context: After merging `origin/preview/integration` (da3ae5f) into `voice-integration`, overlay→shared-session wiring is **blocked**. Do not fake a second `useLiveVoiceSession()` in the overlay.

## What exists today (integration + origin/voice-wiring @ c304fa3)

- `useLiveVoiceSession()` — per-hook `LiveVoiceSession` in a React ref (`start` / `end` / `pressMic` / `toggleMute` / `sendText`). **Not a process-wide singleton.**
- `LiveVoiceBar` owns one hook instance.
- Occupancy (`isLiveVoiceOccupied` / `setLiveVoiceOccupied` / `LIVE_VOICE_BUSY_MESSAGE`) is a **mutex**: blocks a second mic; does **not** attach a second UI to the same session.
- `listen({ mode: "start" | "stop" | "toggle" })` lives in `command-app.tsx` and still opens a **separate** `RealtimeVoiceSession` for the overlay/PTT path. It is **not** exported from `voice-live/`.

## Goal (Voice Integration)

Opening the voice-mode overlay should call the **same** live session the bottom bar uses (`listen({mode:'start'})` / shared start). Closing / End should stop that shared session. If the bar is already live, the overlay must **attach** (UI-only) — never mint a second realtime connection or hold a second mic. Keep overlay stages, Interrupt, echo guard, Retry, and chat-turn persistence.

## Missing API (please add in voice-live; Voice Integration will consume only)

1. **Shared session handle** — one `LiveVoiceSession` (or store) both `LiveVoiceBar` and the overlay can subscribe to. Options:
   - module singleton + `getLiveVoiceSession()` / `subscribeLiveVoiceSession(listener)`, or
   - lift `useLiveVoiceSession` to `command-app` and pass `{ state, start, end, … }` into bar + overlay.
2. **`listen({ mode: "start" | "stop" | "toggle" })` (or documented aliases)** on that shared handle:
   - `start`: start mic if idle; if already active, no-op / attach.
   - `stop` / `end`: release mic and tear down once (bar + overlay both go idle).
3. **Attach semantics** — when occupied by the bar, overlay open must subscribe to phase/level/transcript/error without calling `start()` again and without hitting `LIVE_VOICE_BUSY_MESSAGE`.
4. **Overlay-facing phase mapping** — map live phases (`connecting` / `listening` / `thinking` / `assistant_speaking` / …) to overlay stages (`Connecting` / `Listening` / `Thinking` / `Speaking` / `Interrupted — listening` / error), including barge-in / Interrupt → interrupted-listening.
5. **Callbacks the overlay already relies on** — user + assistant transcripts (for chat-turn save), errors, notices, mute, and a way to interrupt playback that respects the echo guard.
6. **Occupancy contract update** — document that overlay + bar share one occupant; `isOverlayMicOpen` should mean “overlay UI open on the shared session,” not “overlay holds a second mic.”
7. **Exports only** — if anything new is needed, export it from `src/lib/mind/voice-live/index.ts`. Voice Integration will **not** edit `voice-live/` or `live-voice-bar/`.

## What Voice Integration will do once the API lands

- Minimal overlay (and overlay-mount-only `command-app` touch): open → shared `listen({mode:'start'})` / start; close/End → shared stop/end; attach when already active.
- Unit tests: overlay opens while bar live (no second session); overlay closes and releases mic when it owned the start; occupancy respected.
- Will **not** edit `live-voice-bar/`, `voice-live/`, `styles.css`, or non-mount `command-app` regions.

## Explicit non-fixes

- Do not call a second `useLiveVoiceSession()` from the overlay (would be a second session).
- Do not keep overlay on `RealtimeVoiceSession` while the bar uses `LiveVoiceSession` (defeats single-mic goal).
