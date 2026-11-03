# REA internal audit — pass 2026-11-03e (Nov 2 2026, 8:03 PM CST)

## GitHub tool calls made (cursor-github)
1. list_branches per_page=100: 56 branches (was 55). main 014b36d (unchanged), preview/integration b84dcc2 (was 518db93), rea-features d1c7394.
2. compare_commits 518db93...b84dcc2: ahead 2, behind 0. 23860f7 fix(auth): mutable OAuth callback redirect so Set-Cookie can merge. b84dcc2 fix(auth): first-party Google/GitHub OAuth without supabase.co in the browser. 14 files, incl. new src/lib/supabase/first-party-oauth.server.ts (+371), admin.server.ts (+21, service-role client), new routes src/routes/auth/google/callback.tsx and auth/github/callback.tsx, callback.server.ts (+30/-19).
3. get_file_contents @b84dcc2: first-party-oauth.server.ts, admin.server.ts, callback.server.ts.

## Tool runs (main 014b36d tools, unchanged copy at tools-main-014b36d)
- rea.py on live-2026-11-03e (fresh curl of 5 public routes + 3 changed auth files): exit 0 -> tool-runs-2026-11-03e/rea-report.json
- security_review.py on the 3 changed auth files: 0 findings (high 0 / medium 0 / low 0). OAuth state is HMAC-signed with a cookie check; next param goes through safeRedirectPath; service-role client is server-only.
- BlackEye excluded; GodEye not run.

## Status table
| # | Item | Status | Owner |
|---|---|---|---|
| P0 | XAI_API_KEY in Vercel prod | unchanged (env) | Grok Build/Zack |
| P0 | forbidden_cross_site 403 | on preview/integration, not main, not live | Grok Build |
| P0 | /login redirect bug | on preview/integration (+ first-party OAuth b84dcc2), not main, not live | Grok Build |
| P0 | Promote preview to live | CHANGED precondition: besides GROK_PREVIEW_CLIENT_SECRET, Vercel prod now also needs GOOGLE_OAUTH_CLIENT_ID/SECRET, GITHUB_CLIENT_ID/SECRET, an OAuth state secret (OAUTH_STATE_SECRET or SUPABASE_JWT_SECRET or BETTER_AUTH_SECRET), the Supabase service-role key, and the Google/GitHub OAuth apps' redirect URIs updated to /auth/google/callback and /auth/github/callback, or Google/GitHub sign-in breaks on promotion | Grok Build |
| P1 | heavy-asset 404s | branch-only, not live | Media Storage Fleet / Visual Polish |
| - | Cloudflare burner | unchanged (CF email verify) | Grok Build |
| P1-P3 | other baseline items | unchanged | various |

## Pillars (unchanged vs cycle 1)
Whisper Flow partial; Voice Cloning Studio missing; Tool Registry (GodEye only) unchanged; continuous evolution unchanged. No pillar commits this pass.

## Visual
Authenticated walk not run: secure password entry unavailable in scheduled runs (structural, same as prior passes). Public: / 200, /login 200, /memory 200, /explore 200, /dashboard 307 to /login?next=%2Fdashboard (unchanged).

## Changed since last pass
2 auth commits on preview/integration (first-party Google/GitHub OAuth, new callback routes, service-role admin client). +1 branch. Nothing new on main or live. No new blockers; promotion env checklist grew.
