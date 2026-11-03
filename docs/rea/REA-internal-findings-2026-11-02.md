# REA internal findings (unowned) — 2026-11-02

Lane 2 internal-only audit of https://adrians-mind.vercel.app/.  
Only issues **not** already claimed in `/workspace/locks`. Full ranked list + asset upload queue: `/workspace/rea-captures/internal-findings-2026-11-02.md` (+ `.json`).  
Captures: `/workspace/rea-captures/live-vercel-2026-11-02/`.

## 1. Effort Fast/Expert/Heavy advertise model tiers that are not wired
- **Owning bot:** Logic
- **Rationale:** Composer shows Fast/Expert/Heavy but live copy and code say effort does not change the model (Direct path only) — user-facing behavior contradiction.

## 2. Heavy brand/3D/avatar assets pending Media signed-URL migration
- **Owning bot:** Media
- **Rationale:** Live still loads `/brand/*`, `/avatars/*`, and repo `public/dashboard-3d/art/*` as same-origin static files; `GET /api/mind/media/asset-url` returns 404; Supabase buckets empty / signed-link layer not merged — classify **pending_migration** (upload queue with route + `public/`-stripped keys in internal-findings), not broken.

## 3. SPA workspace deep-links 404 outside in-app view state
- **Owning bot:** Grok Build
- **Rationale:** `/settings`, `/library`, `/projects`, `/voice`, `/mcp`, `/tools`, `/chat`, `/command`, `/app`, `/artifacts`, `/connectors` return 404 shells; only `/`, `/login`, `/dashboard` (auth-gated), `/explore`, `/memory`, `/personas→/explore` are real routes — shareable URLs for sidebar destinations are missing.

---

### Owned / do-not-redispatch (recorded in full findings only)
- **Dashboard 307 → login / Universe unreachable anonymously** — owned by **Grok Build** (`grok-build-ui-completion-wiring.lock` claimed); related **Dashboard Bot** locks still claim 3D — lane contradiction noted, not re-flagged as new gap.
- **Connector/MCP 401 honest banners** — error-banners gaps done/released.
- **Generate Image/Video disabled** — expected unconfigured/media lane.
- **Attach/Image/Analyze File** — open file choosers (not dead). Search focuses sidebar search. Speak-last-reply no-op with no reply is expected.

## Owner responses (2026-11-02, post-dispatch)
- **/dashboard 307 → /login** — NOT a gap. Grok Build and Dashboard Bot both confirm the auth gate is intended by Zack's design; the 3D Universe mounts after sign-in. Grok Build is verifying the signed-in DashboardApp renders and will fix only if it doesn't. Recorded as EXPECTED BEHAVIOUR, downgraded from critical.
- **Sidebar deep-link 404 shells** — owned by Grok Build, going into next commit.
- **Effort-tier model wiring** — dispatched to Logic (pending response).
- **44 same-origin heavy assets** — dispatched to Media Storage Fleet as signed-link upload queue (pending migration, not a break).
