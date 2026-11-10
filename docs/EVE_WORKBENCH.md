# EVE Workbench and conversation styles

## Purpose

EVE is the primary operator interface for Adrian Core. This change adds a dedicated **EVE / Intelligence** destination without replacing the existing Chat, Bots & Agents, Runs, Connections or 3D Dashboard destinations.

The initial Workbench is deliberately an evidence view and navigation hub. It displays recorded workspace task runs, run events, browser-session records and file counts. It does not manufacture activity, and an empty panel means no corresponding record is available in the current workspace snapshot.

## Workbench navigation

The header links directly to existing application surfaces:

- **Open Chat** — continue or start a conversation with Adrian Core.
- **Agents** — inspect the existing Bots & Agents surface.
- **Run history** — inspect existing recorded run records.
- **Connections** — manage the existing connected-service surface.
- **3D Dashboard** — open the existing graph/dashboard.

These are navigation links to existing views, not claims that the underlying external services are connected.

## Current capability boundaries

This code change does not create a Paperclip service or persistent hosted worker. Until a real Paperclip instance, authenticated credentials and a server-side adapter are provisioned:

- The Workbench must not claim that a Paperclip agent is online.
- The browser workstation panel may show stored browser-session records, but it does not perform remote browsing.
- Recorded run activity is not proof of a currently executing remote task.
- EVE's identity panel is not a 3D avatar. Character rendering, facial animation, lip-sync and voice/avatar synchronisation require a later implementation.
- Empty and unavailable states must remain explicit.

After Manus provisions Paperclip, the next integration should map authenticated Paperclip agent/run IDs, status, heartbeats, events, results and timestamps into the Workbench. Use the actual installed Paperclip API contract; do not guess endpoints or create a second scheduler.

## Conversation styles

Styles are stored on each chat, independent of the selected provider and character presentation.

Built-in styles:

- Assistant
- Professional
- Storyteller
- Playful
- Romantic
- Supportive
- Unhinged
- Custom

**Custom** accepts an owner-authored style preference of up to 800 characters. The value is trimmed, control characters are removed, and the server applies it only when that chat's style is Custom. It is explicitly treated as presentation guidance, not authority. It cannot grant tools, enable external actions, change approvals, override safety rules or alter owner permissions.

Older chats without a personality field safely default to Assistant. Changing from Custom to another style preserves the custom text so it can be reused later.

## Validation

The feature branch adds regression coverage for:

- built-in style registry and safe defaulting;
- custom prompt character limits and control-character removal;
- custom style persistence on a per-chat basis;
- Direct prompt assembly;
- native system-instruction fields for configured providers;
- logic-route and custom-provider prompt forwarding;
- Workbench destination wiring through the existing command application.

Static wiring and mocked provider tests are not live service acceptance. Real provider calls, OAuth consent, Paperclip jobs, voice playback, avatar rendering and mobile browser behaviour must be independently verified before production completion.
