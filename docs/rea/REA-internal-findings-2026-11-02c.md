# REA internal findings — 2026-11-02c (Lane 2, 8 tracked items)
Branch: origin/preview/integration @ 4371f0e (2026-11-02 00:18 WAT, "perf: lazy assets, split 3D, deferred CSS/JS, cloud memory"). Live: adrians-mind.vercel.app, anonymous. No captures (no live state change).

| Rank | # | Item | Status | Owner | Blocker |
|---|---|---|---|---|---|
| 1 | 7 | Sidebar deep-link 404s (11 paths) | still-blocking-live | Grok Build | All 11 still 404 live; branch has no rewrites/routes for them in vercel.json |
| 2 | 8 | Heavy assets / asset-url | still-blocking-live | Media Storage Fleet | `/api/mind/media/asset-url` 404 live; branch has only client lib (asset-url.ts says endpoints "NOT implemented here"); PR #3 unmerged |
| 3 | 6 | Effort tiers → models | still-blocking-live | Logic | composer-modes.ts: Fast/Heavy "Same Direct path. No separate model configured" |
| 4 | 5 | Live search | still-blocking-live (env) | Logic → Zack | research.ts reads MIND_SEARCH_ENDPOINT/KEY; env unset; `/api/mind/search` 404 live |
| 5 | 3 | Hosted scheduled automations | unowned (partial code) | — | schedule-worker/mind-worker exist on branch, but no hosted runner (no Vercel cron/worker deploy) |
| 6 | 2 | Artifacts/Canvas side panel | unowned | — (Media Integration asleep) | No panel component on branch; /artifacts 404 |
| 7 | 4 | Computer/long-running handoff | unowned | — | No code on branch |
| — | 1 | Guest/logged-out chat | parked-on-Zack | Grok Build (declined) | Design call; `/` renders composer anonymously, no guest auth path in auth/middleware.ts |

Landed-on-branch: none of the 8 fully landed.

## Changed since 02b
- Integration tip moved to 4371f0e (perf/lazy assets + cloud memory); does not touch the 8 items.
- New observation: worker code for #3 exists on branch (not hosted) — moves it from "no code" to "partial, needs a hosting owner".
- Live state for all 8 unchanged.
