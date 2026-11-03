# CONTROLS_VERIFY — Adrian's Mind (logic-controls-wire)

- **When:** 2026-11-02 America/Chicago
- **Base:** `7491b92` (`origin/logic-research-deep`)
- **Branch tip:** see git log on `logic-controls-wire`
- **Product name:** Adrian's Mind

## Quality gate

| Check | Result |
| --- | --- |
| `tsc --noEmit` | PASS |
| `npm run test:mind` | PASS (1845) |
| `npm run build` | PASS |
| `CONTROLS_SMOKE_URL=… node scripts/controls-smoke.mjs` | PASS (logic-lane; media Generate Image stub tolerated) |

## Inventory counts

| Class | Before | After |
| --- | ---: | ---: |
| REAL | 394 | 377 |
| STUB | 23 | 6 (mostly Quick helper false-positives + Generate Image/Video) |
| BROKEN | 0 | 0 |
| NEEDS-CONFIG | 0 | 5 (Speaker, Screen share, Add video, Speak-without-reply path, helper) |

Full table: `/workspace/audit/controls/INVENTORY.md`

## Logic fixes

1. **Notion wiring:** `notionStatus` / `notionDisconnect` / `notionCommand` use `resolveNotionToken(userId)` (OAuth → `NOTION_TOKEN` → `NOTION_API_KEY`).
2. **Fake connected badge:** `probeNotionConnection` requires live `GET /users/me` before `state=connected`.
3. **Voice chrome controls:** Attach / plus-items / Ask focus / Speak / Mute / End / Settings wired to real ChatPane actions; Speaker + Screen share honest needs-config.
4. **Regression:** `scripts/controls-smoke.mjs`

## Skipped (per order)

- Model-tier chip `markPreview` path — queue loop owns it
- Failover — done in `c413891`
- Status card UI component — Grok Build `fix/nav-notion-status` (report only)
- Layout CSS contested by `logic-layout-fix`

## Notion env vars needed (Zack / prod)

- `NOTION_TOKEN` and/or `NOTION_API_KEY`
- OAuth: `NOTION_OAUTH_CLIENT_ID`, `NOTION_OAUTH_CLIENT_SECRET`, `NOTION_OAUTH_REDIRECT_URI`
- Optional: `NOTION_OAUTH_AUTHORIZE_URL`, `NOTION_OAUTH_TOKEN_URL`, `NOTION_OAUTH_REVOKE_URL`

Local box: all missing. No secrets printed.

## Per-owner lists

| File | Items |
| --- | ---: |
| `/workspace/audit/controls/to-grok-build.md` | 3 |
| `/workspace/audit/controls/to-visual-polish.md` | 3 |
| `/workspace/audit/controls/to-voice-wiring.md` | 2 |
| `/workspace/audit/controls/to-voice-integration.md` | 3 |
| `/workspace/audit/controls/to-mcp-integration.md` | 2 |
| `/workspace/audit/controls/to-media-integration.md` | 3 |
| `/workspace/audit/controls/to-dashboard-bot.md` | 2 |
| `/workspace/audit/controls/to-error-banners.md` | 1 |

## Next

- Media Integration: wire Generate Image/Video Quick chips (or honest key needs-config)
- Voice Integration: realtime speaker/screenshare providers
- Zack: set Notion env on Vercel production
- Merge Gate: fold `logic-controls-wire` when ready
