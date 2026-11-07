# REA pass 2026-11-07i — tools summary

Product: Adrian's Mind (never Edurain). Target: https://adrians-mind.vercel.app only. BlackEye excluded. L1B3RT4S not run. Read-only; no app code edits, commits, or force-pushes.

## Exit codes

| Tool | Command | Exit |
|------|---------|------|
| GodEye | `python3 tools/godeye/godeye.py … --requests-only --out …/godeye.json` | 0 |
| ZAP passive | `python3 tools/owasp_zap/zap_passive.py … --out …/zap-passive.json` | 0 |
| git rev-parse / log / ls-remote | local + origin pillar tips | 0 |
| gh compare main…preview/integration | jq status/ahead/behind | 0 |
| gh deployments Production | per_page=3 | 0 |

## GodEye (`godeye.json`)

- Mode: requests-only (engine=requests); status **200**; title **Adrian's Mind**
- **button_count: 69**
- **link/anchor_count: 2** (`/explore`, `/login`; both same-origin 200)
- form_count: 2; input_count: 4; script_count: 2; style_count: 3
- console_error_count: 0; broken_same_origin_count: 0; screenshot: null
- Artifact: `/workspace/rea-captures/pass-2026-11-07i/godeye.json`

## ZAP passive (`zap-passive.json`)

- Engine: in-repo-passive-probe; status **200**; findings_count: **2**
- **Headers present:**
  - `strict-transport-security` (max-age=63072000; includeSubDomains; preload)
  - `x-content-type-options` (nosniff)
  - `x-frame-options` (DENY)
  - `referrer-policy` (strict-origin-when-cross-origin)
- **Headers missing (findings):**
  - Content-Security-Policy (`missing_content_security_policy`, medium)
  - Permissions-Policy (`missing_permissions_policy`, medium)
- Artifact: `/workspace/rea-captures/pass-2026-11-07i/zap-passive.json`

## Git / compare / Production / pillars

| Item | Value |
|------|-------|
| Local worktree | `/workspace/rea-features-wt` branch `rea-features` |
| Local HEAD | `4f976da06631b7b55d241cec999d3100998a911e` (`4f976da docs(rea): internal audit pass 2026-11-07h`) |
| Compare `main...preview/integration` | status **diverged**, ahead_by **85**, behind_by **311**, total_commits **85** (tips checked: main e4ed639 vs preview/integration aa53aa0 per task brief) |
| Production tip (newest of 3) | SHA **e3ccc51**, created_at **2026-11-06 05:38:15 Africa/Lagos** (from 2026-11-06T04:38:15Z); next: 532ed14, 6e66e6f |
| Pillar `whisper-flow` | **5ab07d0** (verified `git ls-remote`: `5ab07d0fdbe33aff315bed6ee4123f368d8bf53b`) — unchanged |
| Pillar `voice-cloning-studio` | **55d12ec** (verified `git ls-remote`: `55d12ec97134a133185bef6be7da114613642afe`) — unchanged |

## Artifacts

- `/workspace/rea-captures/pass-2026-11-07i/godeye.json`
- `/workspace/rea-captures/pass-2026-11-07i/zap-passive.json`
- `/workspace/rea-captures/pass-2026-11-07i/tools-summary.md`
