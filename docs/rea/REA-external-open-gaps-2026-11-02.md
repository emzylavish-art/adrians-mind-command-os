# REA Lane 1 — EXTERNAL open gaps (2026-11-02)

Source: `/workspace/rea-captures/gap-list-2026-11-02.md`
Filter: status **open** AND **not owned** by another bot (no active claim lock). In-progress owned items omitted.

| Title | Owning bot | Rationale |
|---|---|---|
| Guest / logged-out usable chat (progressive auth) | Grok Build | Competitors (ChatGPT/Gemini/HuggingChat/Pi) start before login; Adrian still UnauthorizedError when signed out — top activation gap, no lock. |
| Artifacts / Canvas side panel | Media | Perplexity/Claude/Gemini/Manus ship canvas/artifacts; media canvas lock released/not started. |
| Unattended scheduled automations (hosted worker) | Logic | Perplexity Automations / ChatGPT Scheduled need cloud worker; only local schedule-worker exists. |
| Keyboard shortcut sheet + Cmd+K mount | Visual Polish | Components done (pass-6) but ShortcutSheetHost still unmounted in live chrome. |
| Durable cloud DB / multi-device sync | Grok Build | Default PGLite; competitors sync across devices — broader than memory-table Postgres path. |
| Explore / persona directory linked in main chrome | Visual Polish | `/explore` routes exist; CommandApp nav/sidebar mount still missing vs Poe/Character.AI. |
| Live search provider key product readiness | Logic | Search wiring closed; without `MIND_SEARCH_*` product still refuses — honesty/ops polish. |
| Computer / long-running project handoff | Logic | Perplexity Computer / Manus agentic builds have no Adrian equivalent beyond local HP pairing. |

Notes for Gap Dispatcher:
- Do **not** re-dispatch Projects dashboard (Dashboard Bot claimed) or MCP hardening (MCP locks active).
- Do **not** treat closed cycle-4 items (timeline, OAuth, Drive browse, Imagine, memory UX, retry, search-timeout, persona routes, HP code) as new gaps.
- Capture summary: `/workspace/rea-captures/capture-cycle5-external-summary-2026-11-02.json`
