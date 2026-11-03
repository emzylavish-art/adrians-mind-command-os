# Internal findings — Adrian's Mind live (2026-11-02)

Source capture: `/workspace/rea-captures/live-vercel-2026-11-02/`  
Live base: https://adrians-mind.vercel.app  
Zone: Africa/Lagos

## Route reachability

| Route | Status | Final URL | Notes |
|---|---|---|---|
| `/app` (desktop) | 404 | `https://adrians-mind.vercel.app/app` | 404 shell |
| `/artifacts` (desktop) | 404 | `https://adrians-mind.vercel.app/artifacts` | 404 shell |
| `/chat` (desktop) | 404 | `https://adrians-mind.vercel.app/chat` | 404 shell |
| `/command` (desktop) | 404 | `https://adrians-mind.vercel.app/command` | 404 shell |
| `/connectors` (desktop) | 404 | `https://adrians-mind.vercel.app/connectors` | 404 shell |
| `/dashboard` (desktop) | 200 | `https://adrians-mind.vercel.app/login?next=%2Fdashboard` | auth redirect |
| `/explore` (desktop) | 200 | `https://adrians-mind.vercel.app/explore` | ok |
| `/` (desktop) | 200 | `https://adrians-mind.vercel.app/` | ok |
| `/library` (desktop) | 404 | `https://adrians-mind.vercel.app/library` | 404 shell |
| `/login` (desktop) | 200 | `https://adrians-mind.vercel.app/login` | ok |
| `/mcp` (desktop) | 404 | `https://adrians-mind.vercel.app/mcp` | 404 shell |
| `/memory` (desktop) | 200 | `https://adrians-mind.vercel.app/memory` | ok |
| `/personas` (desktop) | 200 | `https://adrians-mind.vercel.app/explore` | ok |
| `/projects` (desktop) | 404 | `https://adrians-mind.vercel.app/projects` | 404 shell |
| `/settings` (desktop) | 404 | `https://adrians-mind.vercel.app/settings` | 404 shell |
| `/tools` (desktop) | 404 | `https://adrians-mind.vercel.app/tools` | 404 shell |
| `/voice` (desktop) | 404 | `https://adrians-mind.vercel.app/voice` | 404 shell |
| `/dashboard` (mobile) | 200 | `https://adrians-mind.vercel.app/login?next=%2Fdashboard` | auth redirect |
| `/` (mobile) | 200 | `https://adrians-mind.vercel.app/` | ok |
| `/memory` (mobile) | 200 | `https://adrians-mind.vercel.app/memory` | ok |

SPA views exercised from `/`: Chat, Bots & Agents, Build, Projects, Research, Library, Thread, Runs, Connected, Tools, Skills, Scheduled, Memory, Activity, Settings, Help.


## Ranked findings (user impact)

### 1. [CRITICAL] Universe /dashboard no longer renders for anonymous users (HTTP 307 → /login)

- **ID:** `IF-2026-11-02-01`
- **Route/selector:** `/dashboard` — nav a[href="/dashboard"] / route beforeLoad
- **What's wrong:** Live /dashboard returns 307 Location: /login?next=%2Fdashboard. Capture shows login form, 0 canvases, no Universe/3D. Prior capture 2026-11-01 rendered "Adrian's Mind · Universe" with bot constellation. Sidebar still advertises Dashboard as a primary workspace destination.
- **Repro:** curl -sI https://adrians-mind.vercel.app/dashboard → 307 to /login?next=%2Fdashboard; Playwright goto /dashboard lands on login; canvasCount=0
- **Severity:** critical
- **Owned already?** YES — grok-build-ui-completion-wiring.lock (claimed by Grok Build Bot)
- **User impact:** Primary advertised 3D dashboard is unreachable without sign-in; guests see login wall instead of Universe.

### 2. [HIGH] Cannot verify 3D nodes/charts render on live dashboard (auth wall blocks audit)

- **ID:** `IF-2026-11-02-02`
- **Route/selector:** `/dashboard` — canvas / DashboardApp scene
- **What's wrong:** Lane 2 headless audit cannot confirm whether signed-in users still get DashboardApp 3D or the ui-completion CommandApp swap. Zero canvases observed; asset network for dashboard-3d/art/* never requested on live /dashboard.
- **Repro:** Unauthenticated Playwright session → redirected; do not sign in per REA rules. Recorded as blocked.
- **Severity:** high
- **Owned already?** YES — dashboard-3d.lock + dashboard-3d-visual-* (claimed)
- **User impact:** Unknown whether production 3D still ships behind auth; high risk of silent swap to CommandApp.

### 3. [MEDIUM] Heavy brand/3D/avatar assets still served from same-origin /public (pending Media migration)

- **ID:** `IF-2026-11-02-03`
- **Route/selector:** `/, /explore, /memory, /dashboard (when reachable), site-wide` — img[src^="/brand"], /dashboard-3d/art/*, /avatars/*, textures
- **What's wrong:** Network+DOM show assets loaded as https://adrians-mind.vercel.app/brand/... and /avatars/... and (in repo) public/dashboard-3d/art/*. No Supabase signed URLs. GET /api/mind/media/asset-url?key=brand/logo-mark.jpg → 404. Per Media Storage Fleet: classify as pending_migration, not broken.
- **Repro:** Load /; DevTools/network shows /brand/logo-mark.jpg, frost-card-texture.jpg, hero-mono-grain.jpg from app origin. curl asset-url → 404 Not Found.
- **Severity:** medium
- **Owned already?** NO — propose owner **Media**
- **User impact:** Larger TTFB/bundle coupling; migration planned. Not user-broken today.

### 4. [MEDIUM] Effort Fast/Expert/Heavy UI advertises tiers that do not change the model

- **ID:** `IF-2026-11-02-04`
- **Route/selector:** `/` — ComposerEffortControl (Fast/Expert/Heavy)
- **What's wrong:** UI copy: "This effort is not wired to a different model." Code comment in command-app: "Effort does not change model tier. The server model stays on the Direct path." Controls look like model/effort pickers but are cosmetic path labels.
- **Repro:** Open / Chat; click Fast/Expert/Heavy; read helper text under composer.
- **Severity:** medium
- **Owned already?** NO — propose owner **Logic**
- **User impact:** Users believe they select model power; behavior unchanged — trust/UX contradiction.

### 5. [MEDIUM] Connector/MCP status panels require sign-in (401) — honest banners present

- **ID:** `IF-2026-11-02-05`
- **Route/selector:** `/ (Connected view + home)` — ServiceBoard / fleet MCP list banners
- **What's wrong:** 6× OAuth status endpoints 401; UI shows "Status unavailable (sign in required)" and MCP list "Sign in is required" with Retry/View log/Dismiss. Not a silent empty. Previously locked by error-banners (done/released).
- **Repro:** Load / signed out; see banner + Connected cards.
- **Severity:** medium
- **Owned already?** YES — error-banners-gap-* (done, released)
- **User impact:** Signed-out users cannot read connector status — expected until auth; banners are honest.

### 6. [LOW] Deep-link URL routes for SPA views 404 (/settings,/library,/projects,/voice,/mcp,/tools,/chat,/command,/app,/artifacts,/connectors)

- **ID:** `IF-2026-11-02-06`
- **Route/selector:** `/settings etc.` — HTTP routes
- **What's wrong:** Only real app routes live: /, /login, /dashboard (gated), /explore, /memory, /personas→/explore. Sidebar items are in-app views except Dashboard link. Bookmarking /settings returns tiny 404 shell (1354 bytes).
- **Repro:** curl -sI each path → 404 for listed routes; 200 for / explore memory login.
- **Severity:** low
- **Owned already?** NO — propose owner **Grok Build**
- **User impact:** Low unless users expect shareable URLs; in-app nav works.

### 7. [LOW] Generate Image / Generate Video quick actions disabled when unsigned/unconfigured

- **ID:** `IF-2026-11-02-07`
- **Route/selector:** `/` — Quick actions Generate Image / Generate Video
- **What's wrong:** Buttons present but disabled=true. Imagine control remains available. Honest disabled, not dead-click.
- **Repro:** Home Chat; inspect Generate Image/Video disabled attribute.
- **Severity:** low
- **Owned already?** YES — media-integration* (Imagine/media paths)
- **User impact:** Low — disabled state prevents false starts.

### 8. [INFO] Login surface expanded (email/password + Google/GitHub/Apple/X)

- **ID:** `IF-2026-11-02-08`
- **Route/selector:** `/login` — login form
- **What's wrong:** Not broken — delta vs Nov1 (Google+X only). Recorded for awareness; visual-polish-login previously worked this area.
- **Repro:** Open /login
- **Severity:** info
- **Owned already?** YES — visual-polish-login.lock (done) / grok-build-ui-completion-wiring.lock (claimed)
- **User impact:** Positive expansion; auth still required for owner features.


## Pending migration asset queue (Media)

Convention: Supabase project `xarxhdsnprpnosimehon`, bucket `media-brand`, key = repo path with `public/` dropped. Fetch later via `GET /api/mind/media/asset-url?key=<key>` → `{url, expiresAt}` (1h). Currently API 404; buckets empty.

| Bytes | Route | Repo path | media-brand key |
|---:|---|---|---|
| 340485 | / (home chrome); also /explore,/login,/memory as applicable | `public/brand/textures/frost-card-texture.jpg` | `brand/textures/frost-card-texture.jpg` |
| 217991 | / (home chrome); also /explore,/login,/memory as applicable | `public/avatars/bot-sheet.jpg` | `avatars/bot-sheet.jpg` |
| 197496 | /dashboard | `public/dashboard-3d/art/backdrop-city.webp` | `dashboard-3d/art/backdrop-city.webp` |
| 137258 | /dashboard | `public/dashboard-3d/art/backdrop-nebula.webp` | `dashboard-3d/art/backdrop-nebula.webp` |
| 134108 | /dashboard | `public/dashboard-3d/art/backdrop-interior.webp` | `dashboard-3d/art/backdrop-interior.webp` |
| 123437 | / (home chrome); also /explore,/login,/memory as applicable | `public/brand/textures/hero-mono-grain.jpg` | `brand/textures/hero-mono-grain.jpg` |
| 121185 | / (home chrome); also /explore,/login,/memory as applicable | `public/brand/logo-mark.jpg` | `brand/logo-mark.jpg` |
| 103612 | PWA/install surfaces | `public/__grok/install/assets/homescreen/ob-phone.png` | `__grok/install/assets/homescreen/ob-phone.png` |
| 101843 | PWA/install surfaces | `public/__grok/install/assets/homescreen/ob-ipad.png` | `__grok/install/assets/homescreen/ob-ipad.png` |
| 101641 | / (home chrome); also /explore,/login,/memory as applicable | `public/avatars/avatar-documents.png` | `avatars/avatar-documents.png` |
| 101384 | /dashboard | `public/dashboard-3d/art/building-guild.webp` | `dashboard-3d/art/building-guild.webp` |
| 95004 | /dashboard | `public/dashboard-3d/art/building-orchestrator.webp` | `dashboard-3d/art/building-orchestrator.webp` |
| 94852 | /dashboard | `public/dashboard-3d/art/building-gap-cycle.webp` | `dashboard-3d/art/building-gap-cycle.webp` |
| 94615 | / (home chrome); also /explore,/login,/memory as applicable | `public/brand/hero-bg.jpg` | `brand/hero-bg.jpg` |
| 94396 | /dashboard | `public/dashboard-3d/art/portrait-cosmos-painter.webp` | `dashboard-3d/art/portrait-cosmos-painter.webp` |
| 84970 | /dashboard | `public/dashboard-3d/art/portrait-mcp-integration.webp` | `dashboard-3d/art/portrait-mcp-integration.webp` |
| 84764 | /dashboard | `public/dashboard-3d/art/portrait-cosmos-light.webp` | `dashboard-3d/art/portrait-cosmos-light.webp` |
| 77017 | / (home chrome); also /explore,/login,/memory as applicable | `public/avatars/avatar-research.png` | `avatars/avatar-research.png` |
| 77002 | /dashboard | `public/dashboard-3d/art/portrait-gap-dispatcher.webp` | `dashboard-3d/art/portrait-gap-dispatcher.webp` |
| 77002 | /dashboard | `public/dashboard-3d/art/portrait-gap.webp` | `dashboard-3d/art/portrait-gap.webp` |
| 76387 | / (home chrome); also /explore,/login,/memory as applicable | `public/avatars/avatar-build.png` | `avatars/avatar-build.png` |
| 74960 | /dashboard | `public/dashboard-3d/art/portrait-visual-polish.webp` | `dashboard-3d/art/portrait-visual-polish.webp` |
| 72690 | /dashboard | `public/dashboard-3d/art/portrait-error-banners.webp` | `dashboard-3d/art/portrait-error-banners.webp` |
| 72600 | /dashboard | `public/dashboard-3d/art/portrait-media-integration.webp` | `dashboard-3d/art/portrait-media-integration.webp` |
| 72204 | /dashboard | `public/dashboard-3d/art/portrait-dashboard.webp` | `dashboard-3d/art/portrait-dashboard.webp` |
| 70292 | /dashboard | `public/dashboard-3d/art/portrait-conductor.webp` | `dashboard-3d/art/portrait-conductor.webp` |
| 69754 | /dashboard | `public/dashboard-3d/art/portrait-voice-wiring.webp` | `dashboard-3d/art/portrait-voice-wiring.webp` |
| 69536 | /dashboard | `public/dashboard-3d/art/portrait-hp-pairing.webp` | `dashboard-3d/art/portrait-hp-pairing.webp` |
| 69500 | /dashboard | `public/dashboard-3d/art/portrait-merge-gate.webp` | `dashboard-3d/art/portrait-merge-gate.webp` |
| 69035 | / (home chrome); also /explore,/login,/memory as applicable | `public/avatars/avatar-notion.png` | `avatars/avatar-notion.png` |
| 67130 | /dashboard | `public/dashboard-3d/art/portrait-grok-build.webp` | `dashboard-3d/art/portrait-grok-build.webp` |
| 66876 | / (home chrome); also /explore,/login,/memory as applicable | `public/avatars/avatar-email.png` | `avatars/avatar-email.png` |
| 66368 | /dashboard | `public/dashboard-3d/art/portrait-cosmos-motion.webp` | `dashboard-3d/art/portrait-cosmos-motion.webp` |
| 64074 | /dashboard | `public/dashboard-3d/art/portrait-rea-feature-hunter.webp` | `dashboard-3d/art/portrait-rea-feature-hunter.webp` |
| 64074 | /dashboard | `public/dashboard-3d/art/portrait-rea.webp` | `dashboard-3d/art/portrait-rea.webp` |
| 57926 | /dashboard | `public/dashboard-3d/art/portrait-voice-integration.webp` | `dashboard-3d/art/portrait-voice-integration.webp` |
| 56742 | /dashboard | `public/dashboard-3d/art/portrait-logic.webp` | `dashboard-3d/art/portrait-logic.webp` |
| 45934 | /dashboard | `public/dashboard-3d/art/portrait-xai-verification.webp` | `dashboard-3d/art/portrait-xai-verification.webp` |
| 45644 | / (voice test fixtures) | `public/voice-test/question.wav` | `voice-test/question.wav` |
| 40749 | / (home chrome); also /explore,/login,/memory as applicable | `public/og.jpg` | `og.jpg` |
| 14444 | / (voice test fixtures) | `public/voice-test/hello.wav` | `voice-test/hello.wav` |
| 11318 | / (home chrome); also /explore,/login,/memory as applicable | `public/avatars/avatar-documents.webp` | `avatars/avatar-documents.webp` |
| 8744 | / (home chrome); also /explore,/login,/memory as applicable | `public/avatars/avatar-build.webp` | `avatars/avatar-build.webp` |
| 8368 | / (home chrome); also /explore,/login,/memory as applicable | `public/avatars/avatar-research.webp` | `avatars/avatar-research.webp` |