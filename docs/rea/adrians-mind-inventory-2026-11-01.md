# Adrian's Mind Command OS — feature inventory (2026-11-01)

**Repo:** `/workspace/mind-command-os` (git)  
**Branch at inventory time:** `visual/polish-pass-1` @ `b7a57c1` (working tree may move; see gap commit on `rea-features`)  
**Sources:** `README.md`, `ENGINEERING.md`, `docs/FEATURE_COMPLETION_MATRIX.md`, `docs/PLATFORM_CAPABILITY_RESEARCH.md`, `docs/EXTERNAL_BLOCKERS.md`, `src/components/mind/*`, `src/lib/mind/{types,registry,fleet,requirements}.ts`, prior `/workspace/audit/mind-os/gap-report.md`

## Product shape

- Private Mind command app; UI entry `src/components/mind/command-app.tsx`.
- Browser workspace `amcos.workspace.v1`; optional owner-scoped server PGLite/Postgres snapshot (`migrations/0002_mind.sql`).
- Ask mode default; memory off by default; delete/replace always ask; emergency stop; stream Grok only on Send; unfinished replies not saved.
- Sign-in required for Grok, voice, REA, server copy, emergency-stop mutations; page still loads signed-out.

## Navigation / shell (implemented)

| Area | What exists | Strength |
|---|---|---|
| Grouped sidebar | Workspace / Systems / Personal groups; collapsible; mobile menu + bottom bar (Command, Chat, Agents, Runs) | Strong shell |
| Views | Chat, Thread, Bots & Agents, Build, Projects, Research, Library, Runs, Connected, Tools, Skills, Scheduled, Memory, Activity, Settings, Help | Broad IA |
| Command palette | Ctrl/Cmd+K via `paletteHits` — destinations, agents, runs, chats, projects, notes, files | Present (local) |
| Pins | Fleet pins in workspace snapshot | Present |
| Theme | dark / light / system (`amcos.theme.v1`) | Present |
| Model tier chrome | Auto / Fast / Expert / Heavy / Build presentational picker | UI present; not wired to provider effort APIs |
| Failure banner | One-line failure + Retry + View log → Activity (preview/error-banners lineage) | Improving |

## Chat / transcript

- Streaming assistant replies; stop-this-reply aborts client + server outbound; regenerate / retry / rename / edit user turn / export chat JSON / copy code fences (`MessageBody`).
- Modes: Ask / Agent / Research / Build intents via `interpretCommand` + `commandMode`.
- Attach: local file staging (text/PDF extract path); image analyze server hook exists when authorized.
- Provider radios: Grok enabled only with server key; OpenAI/Anthropic/Gemini/OpenRouter refused (no silent fallback).
- Temporary chat + per-chat memory on/off + autonomy ask/automatic.
- Speak: one-shot browser speech / `speakText` — **not** full-duplex voice.
- Dictate control exists in composer chrome (depth varies by branch polish).

## Agents / fleet / runs

- Agent templates, custom agents with selected tools, deploy record (`external-required` for hosted).
- Local worker `tickFleet`; pause/cancel/resume/approve run actions; run events list on Runs view.
- Bounded planner: up to ~3–4 tools (`list_projects`, `list_chats`, `search_notes`), time/step limits, stoppable.
- Schedules: local due queue + enable toggle; hosted worker blocked without `DATABASE_URL`.
- Browser inspect: headless page open for explicit URL (limitations).
- Mailbox / connection records without secrets; Gmail connect stub refuses (no OAuth).

## Research / media / integrations

| Capability | Status |
|---|---|
| Web research citations | UI exists; blocked without `MIND_SEARCH_ENDPOINT` + `MIND_SEARCH_KEY` |
| Image / video gen | Paid APIs not called; blocked/paid_required |
| Notion | Status + command hooks; OAuth often unconfigured |
| MCP | list/save/remove/command; handshake often not connected |
| Service board | Notion, GitHub, Gmail, Drive, Docs, Calendar, Slack, providers, search, media, voice, MCP, local computer — mostly Not connected / Setup detail only |
| REA | Pinned `rea-agents@6.8.0`; doctor unhealthy (Node floor, native engines) |
| HP EliteBook / iPhone | Not paired; Build workspace blocked |
| Zapia | Deferred / planned |

## Memory / projects / library / settings

- Memory scopes global/project/chat; versions; archive; transfer tab; default off.
- Projects: create/about/open; chats filterable by project.
- Library: local files in workspace snapshot.
- Settings: appearance, import/export workspace archive, requirement/capability boards, failover note, owner guide cues.
- Activity: audit log of human-readable actions.

## Auth / security / persistence

- better-auth; owner gates; CSRF/cross-site rejection on mind APIs; rate limits in-process.
- Halt file per owner; SQL `mind_control` for durable halt once `DATABASE_URL` set.
- Browser vs server snapshot merge policy (browser wins until owner chooses).

## Explicit non-goals / blockers (today)

- No multi-provider live catalog like Poe.
- No Deep Research multi-step reports without search keys.
- No cloud attach (Drive/OneDrive).
- No realtime voice / Live mode.
- No Artifacts/Canvas IDE without paired computer.
- No working OAuth connector catalog.
- Oak Bridge / BridgePoint deliberately separate and unused.

## Prior competitive evidence already on box

- Signed-in UI findings: `/workspace/audit/signed-in/findings-*.md`
- Gap report: `/workspace/audit/mind-os/gap-report.md`
- Public partial screens: `/workspace/audit/public-rea/`
- This cycle public captures: `/workspace/rea-captures/<platform>/`
