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

## GitHub tool-backed verification (2026-11-02, parent)
GitHub tool calls made on emzylavish-art/adrians-mind-command-os:
1. get_branch `preview/integration` → head **4371f0e** (parent 2a2fb16), commit "perf: lazy assets, split 3D, deferred CSS/JS, cloud memory" + "wire: shortcut sheet + Explore nav". `deploymentEnabled.preview/integration = false` (confirmed in vercel.json) → **nothing on this branch is deployed**, which is why the live site still shows the pre-integration state.
2. get_file_contents `vercel.json` @preview/integration → only cache-header rules for `/assets/*`, `/art/*`, `/dashboard-3d/art/*`; **no rewrites/routes for the 11 deep-link paths** → item #7 (deep-link 404s) is a real, still-open gap, confirmed at source.
3. search_code `MIND_SEARCH_ENDPOINT` → 0 results, and `asset-url` → 0 results. Note: GitHub code search only indexes the **default branch**; this code lives on feature/preview branches, so 0 results is a search-index limitation, not proof of absence. Branch-level reads (get_file_contents on the specific branch) are the authoritative check and will be used for these next cycle.

Net: branch tip 4371f0e carries the shortcut-sheet + Explore-nav wiring and a getAssetUrl shim (Grok Build / Media), but `deploymentEnabled=false` means none of it is live yet. The 8-item live-vs-shipped status above stands.
