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

## Ownership updates (post-dispatch, 2026-11-02)
- **Durable cloud DB / multi-device sync** — NOW OWNED by Grok Build (in perf pass atop preview/integration 2a2fb16; Supabase xarxhdsnprpnosimehon). Remove from open list.
- **Guest / logged-out usable chat** — Grok Build declined: changes Zack's sign-in-gated design, needs Zack's call first. STAYS OPEN, parked on Zack's design decision.
- **Artifacts / Canvas side panel** — Media Integration declined (lane asleep, no new features). UNOWNED; needs Zack to assign a lane.
- Note: Grok Build is now sole merger; REA already pushes to rea-features only (no merges).
- **Unattended scheduled automations (hosted worker)** — Logic declined (lane on "no new features"). UNOWNED; needs Zack to assign a lane.
- **Computer / long-running project handoff** — Logic declined (same). UNOWNED; needs Zack to assign a lane.
- **Live search provider key readiness** — Logic: not code work; search wiring done, only needs Zack to supply env `MIND_SEARCH_ENDPOINT` + `MIND_SEARCH_KEY`. Logic is raising with Zack.
- **Shortcut sheet + Cmd+K mount** and **Explore entry in CommandApp nav** — Visual Polish declined (lane is CSS/asset polish only, no new TSX mounts in command-app.tsx). These are integration/wiring → REROUTED to Grok Build (owns integration + deploy fold-in). Visual Polish will style the sheet glass/elevation + nav active state once mounted.
- **Shortcut sheet + Cmd/Ctrl+K + '?' mount** and **Explore nav entry** — NOW OWNED by Grok Build (going into next commit on preview/integration atop 2a2fb16). Visual Polish styles after mount.

## STANDING-RULE CHANGE (2026-11-02): External hunting OFF permanently. This is the final external gap list. Future cycles are Lane 2 (internal audit) only.
