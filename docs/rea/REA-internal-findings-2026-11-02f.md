# REA internal audit — pass f (2026-11-02 15:32 CST)

## GitHub tool calls made (cursor-github)
1. list_branches per_page=100: 59 branches. preview/integration is now 1ea70b9 (was 4371f0e), main is now 014b36d (was 714ad22).
2. compare_commits 4371f0e...preview/integration: ahead 1 (1ea70b9 "unify: burner consolidated build", 2026-11-01 18:14 CST), 107 files changed. Patches read for isolation.server.ts, agent-run.server.ts, login.tsx.
3. compare_commits 1ea70b9...main: diverged, main ahead 252 / behind 9. Main does NOT contain 1ea70b9. Main's new commits are tool-install/registry work (latest 014b36d, 2026-11-02 15:05 CST, "Record executed Linux tool setup and fix workspace checks").

## Status changes
| # | Item | Was | Now | Owner |
|---|---|---|---|---|
| P0 | forbidden_cross_site 403 (isolation.server.ts + agent-run.server.ts) | no fix on any branch | FIX LANDED on preview/integration 1ea70b9 (decideFetchSite now allows Origin = prod or *-adrian-8a30.vercel.app preview). Not on main, not verified live. | Grok Build |
| P0 | /login redirect bug (login.tsx) | no fix | FIX LANDED on preview/integration 1ea70b9 (serverFnRedirectHref follows returned/thrown redirects; Supabase preferred over Better Auth). Not on main, not verified live. | Grok Build |
| P1 | heavy-asset 404s | PR #3 unmerged | asset-url.ts / asset-sign.ts / resolve-asset-urls touched in 1ea70b9; branch only, not verified live. | Media Storage Fleet |
| P0 | XAI_API_KEY in Vercel prod | unset | unchanged (env, not checkable from GitHub) | Grok Build/Zack |
| — | Cloudflare burner | blocked on CF email verify | still no burner URL in /workspace/locks/cf-burner.md | Grok Build |
All other baseline items unchanged.

## Visual
Authenticated walk not run: secure password entry is unavailable in scheduled runs. Public check: /login 200; /dashboard 307 to /login?next=%2Fdashboard (unchanged).

## Changed since last pass
Two P0 fixes and asset-url work landed on preview/integration via 1ea70b9. Main has diverged from preview/integration (252 ahead, 9 behind), so the merge to the deploy branch needs care. No new blockers.
