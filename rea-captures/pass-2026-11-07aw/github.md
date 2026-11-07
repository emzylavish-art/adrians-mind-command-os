# GitHub — pass 2026-11-07aw (method B)
Product: **Adrian's Mind** / Adrian's Mind Command OS  
Repo: `emzylavish-art/adrians-mind-command-os`  
Collected: 2026-11-07 ~10:22–10:24 WAT (Africa/Lagos)  
Mode: read-only

## Tip SHAs (vs prior 2026-11-07av / known)

| Ref | Full SHA | Short | Tip message | vs 07av |
|-----|----------|-------|-------------|---------|
| origin/main | `b5d888dd107c4a06de582a0e29fce551c95b01df` | `b5d888d` | Merge PR #23 OAuth MCP bridge + Astra/Sol/Luna routing MVP | **UNCHANGED** |
| origin/preview/integration | `aa53aa0ad54486d9af6649a1307c524c6c34527f` | `aa53aa0` | Phase 5: harness MODEL_PROVIDER xai/openai readiness probe | **UNCHANGED** |
| origin/whisper-flow | `5ab07d0fdbe33aff315bed6ee4123f368d8bf53b` | `5ab07d0` | test(whisper-flow): wait for hydration after integration drawer UI | **UNCHANGED** |
| origin/voice-cloning-studio | `55d12ec97134a133185bef6be7da114613642afe` | `55d12ec` | visual(vcs): polish engine-down empty card + error alert cards | **UNCHANGED** |
| origin/rea-features | `54a7821c8e5707d91b24a58f4b8e181a70c4b0d4` | `54a7821` | docs(rea): internal audit pass 2026-11-07av | (rea docs tip; not a tracked product tip) |

`git fetch origin --prune` only advanced non-tracked branch `cursor/prod-mcp-worker-de4c` (`43301c0..e682b1b`). Tracked tips above did not move.

## Branch count
- list_branches per_page=100: **page1=100**, **page2=8**, **total_listed=108** (same as 07av)
- Link header confirmed page 2 is last

## Recent commits (~5)

### main
1. `b5d888d` Merge PR #23 codex/mcp-oauth-mvp — OAuth MCP bridge + Astra/Sol/Luna routing MVP (2026-11-07T07:46:17Z → **08:46:17 WAT**)
2. `a19adbb` Merge PR #24 cursor/worker-mcp-tools-de4c — free authenticated Worker MCP entrypoint
3. `fcab42b` Fetch harness MCP evidence over public HTTPS
4. `30843aa` Verify Cloudflare Access JWTs + same-host PKCE harness
5. `267dc39` Publish test worker bundle outside ignored dist path

### preview/integration
1. `aa53aa0` Phase 5: harness MODEL_PROVIDER xai/openai with one-token readiness probe (2026-11-03T06:18:24Z → **07:18:24 WAT**)
2. `c1ee830` fix(ui): phone drawer nav + honest Notion status
3. `b84dcc2` fix(auth): first-party Google/GitHub OAuth without supabase.co in browser
4. `23860f7` fix(auth): mutable OAuth callback redirect so Set-Cookie can merge
5. `518db93` fix(login): keep Google/GitHub enabled on auth loader fallback

## compare_commits base=main head=preview/integration
- status: **diverged**
- ahead_by: **85**
- behind_by: **320**
- total_commits: **85**
- html: https://github.com/emzylavish-art/adrians-mind-command-os/compare/main...preview/integration
- **UNCHANGED** vs known (ahead 85 / behind 320) and vs 07av
- files listed in compare payload: 300 (API page)

## tools/registry.json
### @ main
- BlackEye: restricted / blocked / blocked
- God's Eyes: **identity-unconfirmed** / not-installed / not-connected
- REA: implemented / callable-cli-and-ci
- OWASP ZAP: source-verified / not-connected (wrapper still used from repo)
- L1B3RT4S: source-verified / not-connected — **NOT RUN**
- GodEye upstream still unconfirmed on main registry

### @ rea-features
- God's Eyes: **implemented** / repo-code-present / callable-cli-and-ci; entrypoint `tools/godeye/godeye.py`; note "upstream identity still unconfirmed"
- OWASP ZAP: **implemented** / callable-cli-and-ci; entrypoint `tools/owasp_zap/zap_passive.py`; passive-only
- BlackEye still restricted/blocked
- L1B3RT4S still not-connected / not run
- Same structural delta vs main as prior passes (rea-features marks GodEye+ZAP implemented)

## get_git_tree main (non-recursive)
Top-level includes: `.devcontainer`, `.github`, `AGENTS.md`, `agent`, `docs`, `mcp`, `migrations`, `public`, `scripts`, `server`, `src`, `team`, `tools`, `upstream`, `workers`, `vercel.json`, `vite.config.ts`, etc. `truncated=false`.

## Vercel production (user-Vercel--adrian)
- Project `adrians-mind` id=`prj_Q7tqShINgZgu0ZWkQNiIOG32WT0D` team=`team_yDp5IRAsrXLP2t9V0z2iCRZX`
- Latest READY production: `dpl_HmAxBEus6oL75hCkTuXE8NDSM9qF`
- git: **main** @ `b5d888dd107c4a06de582a0e29fce551c95b01df` — matches origin/main tip (**UNCHANGED**)
- Plain `user-Vercel` without adrian scope: project_not_found (use `--adrian`)

## Live asset / headers
- Asset: `/assets/index-ChogKXym.js` (+ react/actions/link/route chunks) — **UNCHANGED**
- Headers (HTTP/2 200): HSTS, X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy; **no CSP**; **no Permissions-Policy**
- Saved: `live-assets.txt`, `headers-full.txt`
