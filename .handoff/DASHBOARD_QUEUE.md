# Dashboard forever-contract upgrade queue

## Cadence (Zack 2026-11-01)

2-hour interval **removed**. Dashboard Bot + visual fleet (Painter/Light/Motion) run **continuously**, back-to-back. After each landing, start the next cycle immediately. **5-minute safety restart** skips if a cycle is already running (no-ops while the lane lock is claimed). Report to parent every **two** upgrades.

Last release: Dashboard c57 — FF a00fc32/5ab86fe; register #109 tests; wire stillTarget + Painter Imagine/lore/city pool + operator budget chip. Skipped ink weight (no edge.activity). Next: Light #110 or cloud signed-URL hosts.


## c43 attacker pass ranked
| Gap | Rank | Notes |
|-----|------|-------|
| #22 Spend JSONL | **done** | tail+partial+canonical; no USD source on box |
| #30 hostile branch/notes HTML | **fixed c43** | sanitizeHostileText in bot-normalize |
| #31 Notion outage badge | P2 | |
| #32 WebGL mid-zoom restore desync | P2 | |
| #33 500+ bots status O(n) cold | P2 | |
| #34 hidden-tab money burn window | P3 | |
| Motion 3fff118 / Painter bbf6c47 | landed | motion/+particles/; materials/shaders |

## Probe 20261101-162902 ranked (after c42)

| Item | Rank | Notes |
|------|------|-------|
| Gap#29 remaining HTML-embedded paths | **P0 follow-up in c42b** | bare `/workspace` in notion excerpts — harden BARE_ABS_PATH_RE |
| Gap#28 cache | **done** | parallel8 wall ~0.04s; warm GET ~4ms on :8102 |
| Gap#29 methods | **done** | POST/PUT/PATCH/DELETE → 405 JSON + Allow:GET; raw bags=0 |
| Filters Groups | **done** | capture filtersOpen=true; no TDZ/feedback |
| Next gap-feed head after #29 | **read latest ###** | continue from newest undelivered gaps below #29 |

## Motion / Painter lane notes (c42)
- Motion tip `831225f` also listed `package.json` — **skipped**; registered `wind-gust.test.ts` in dashboard lane (no new runtime deps).
- Painter tip `94c28c7` rebased on dashboard-3d (wide MB diff); landed **materials/shaders only** from the c10 commit; `styles.css` not taken.


## Gap Dispatcher 20261101-220802 ranked into queue (c41)

| Gap | Rank | Action |
|-----|------|--------|
| #26 ink-edge `nhopVisibleIds` TDZ crash | **P0 — fixed c41** | Hoist filter sets before apply; `edge-visibility` helper + regression tests |
| #27 Filters toggle under Notion Mirror (1280×800) | **P1 next** | Reposition toggle to skybar/toolbar; z-order in dashboard-3d.css |
| #28 Status API ~1s / 214KB / serial blocking | **P2** | Server-side short TTL + single-flight; lazy timeline/notionGraph (dashboard lane) |
| #29 Status leaks `/workspace` paths + raw notes; non-GET 200 | **P1 security** | Redact paths/raw; 405 non-GET before public deploy |
| Motion tip `a65cd9a` | note | Touches `package.json` outside lane — land **motion/ only**; add any needed test script entries in dashboard lane after review (no new runtime deps unless essential) |


Ordered. Status: `done` | `active` | `queued`.  
Branch: `dashboard-3d` · Worktree: `/workspace/mind-command-os-dashboard`  
Painter lane branch: `dashboard-3d-visual-painter` · Worktree: `/workspace/mind-command-os-dashboard-painter`  
Constraint: only this branch/worktree, `/workspace/locks/dashboard-3d*.lock`, `/workspace/audit/dashboard-3d/`, Notion handoff pages.

| # | Upgrade | Status | Notes |
|---|---------|--------|-------|
| 0 | **Universe** (+ Visual Fleet stars + extension folders) — painterly cosmos, constellations, Notion galaxy snapshot, weather, fly-to camera rig foundation | **done** | Landed on dashboard-3d; light/painter/motion fill lane folders |
| 0b | **Light — health-tinted lights + bloom/color-grade** | **done** | Cosmos Light Bot; wired in 405ef30 |
| 0c | **Painter kit (shaders/materials)** — brush/watercolor ShaderMaterials, star+building surfaces, paper grain, procedural nebula, painterly post-pass + `createPainterlyKit` | **done** | Cosmos Painter Bot; wired in 405ef30 |
| 0d | **Painter — constellation lore plaques** — watercolor plaque ShaderMaterial + procedural parchment | **done** | Cosmos Painter Bot; `createLorePlaqueMaterial` + `makeParchmentRGBA`; sky dispose leak + mediump paintWrap hacker fixes |
| 1 | **Camera / city flyover + Projects** — universe→city→interior FSM; projects as painted buildings (progress floors, tasks, bots, agent stats); real local data only | **done** | 29addee — `flyover-fsm.ts` + `city-layout.ts` + `city/city-layer.ts` (createBuildingBrushMaterial) + interior panel/HUD; wheel-push crosses levels, city pan clamped; shots flyover-high/city/interior. Remaining polish → folded into #2 (real canvas door/window click tuning, damped dolly) |
| 2 | **Click-and-zoom** — star click eases camera in + detail; wheel/pinch dolly; empty-space/zoom-out → sky; reuse camera FSM | **done** | c9 — damped glide (`stepRigSmooth`), glide-spam guard, pinch+wheel dolly, detail card (lane health, commits, API spend honest empty, status); empty-click / Zoom to sky → `UNIVERSE_HIGH`; reuses flyover FSM |
| 3 | **Animation pass** — living motion: orbiting, drifting, pulsing, transition polish | **done** | c9 — star pulse/emissive by health, constellation edge flow, landing-trail travelers, MotionClock + `document.hidden` pause, reduced-motion static; tickPainterlyKit wired |
| 4 | **Sound** — WebAudio procedural only; health tones spatialized; muted by default + unmute toggle | **done** | c11 — `health-sound.ts` WebAudio; unlock on first click; mute in localStorage; hidden/reduced-motion silent; MAX_VOICES=8 hacker cap |
| 5 | **Time** — timeline scrubber from git commits + lock timestamps; real data only | **done** | c12 — `time-scrub.ts`; fleet+dashboard git + lock claim/release/heartbeat + transition log; stars recolor; Live button; no fake interpolate; hacker 10k/future/skew |
| 6 | **Feed** — Conductor nudges + Gap Dispatcher as drifting sky events (comets/lanterns) | **done** | c13 — `sky-feed.ts` + feed glyphs/CSS2D + glass list; real conductor/gap/lock/git/landing/merge/notion; hacker flood/dedupe/sanitize/stale; click→fly bot |
| 7 | **Money** — API spend burn/daily/per-lane warning from real source only; honest empty element | **done** | c14 — `spend.ts` adapter (filesystem JSON/JSONL); UI Money panel; **no spend source yet** on box; hacker NaN/neg/overflow/stale; warnings only on real thresholds |
| 8 | **Operator layer** — in-dashboard camera/focus/last-node in localStorage only (no geolocation) | **done** | c16 — Cmd/Ctrl-K palette; fly bot/building/notion; health filter; layer toggles; copy lock/branch; XSS/hotkey/cap hacker |
| 9 | **Notion mirror** — render handoff `40b1aa27…` stop-point + next task in-world (snapshot/MCP; live if token) | **done** | c16 — per-bot snapshot stop/mapped pages, freshness + stale (6h); panel; fallback empty no source yet |
| 10 | **Forever-contract guard** — keep this queue non-empty; append next researched upgrade after each ship; show queue head in-world | **done** | c20 (c17 WIP landed) — skybar panel: queue tone green≥3/amber1–2/red0, unknown when queue file unreadable (Vercel); next 4 queued listed; lane-idle needs-next@30m; unit test fails if 0 queued; REA-grounded #14–16 appended |
| 11 | **Light — depth-aware god-ray shafts** | **done** | Landed+wired c9: `createGodRayPass` before bloom; depth RT; intensity ↔ healthy/total; off under reduced-motion |
| 12 | **Light — health-reactive exposure ride** | **done** | Landed+wired c9: `createExposureRide` eases ACES+bloom threshold ~400ms; idle until data; reduced-motion snaps |
| 13 | **Light — WebGL context-loss recovery** | **done** | Landed+wired c10: `createContextLossRecovery` owns bloom/grade/rays/exposure across lost/restored; atm post-dispose fog guard |
| 14 | **Operator last-node breadcrumb** — show last palette target in Flyover HUD from localStorage only | **done** | c21 — Flyover HUD last palette target + Revisit; prefs lastNodeId sanitized; missing-target mark; hacker XSS tests |
| 15 | **Mobile / touch pass** — larger skybar hit targets, touch-friendly operator open, safe-area padding | **done** | c22 — 44px hit targets + safe-area on skybar/flyhud; Operator open aria; hotkey 300ms debounce hacker |
| 16 | **Accessibility pass** — focus rings, aria on forever/operator, skip-link to skybar | **done** | c23 — skip-link to #dash3d-skybar; focus-visible rings; operator aria-labelledby; forever region already labeled |
| 17 | **Perf budget at 18+ bots** — frame/draw hint when bot count ≥18; pause nonessential CSS2D under budget miss | **done** | c24 — perf-budget EMA; CSS2D label pause at ≥18 + >24ms; skybar hint; NaN/neg hacker tests |
| 18 | **City night-shift windows** — per-floor window glow only for floors whose lock changed in last 30 min (real claimed_at/released_at); steady under reduced-motion | **done** | c25 — night-shift from lastActivityAt ≤30m; warm window floors; reduced-motion steady; hacker null/garbage timestamps |
| 19 | **Feed severity pulse** — pulse sky-feed glyphs faster when Merge Gate / lock notes mention blocked/main (real text only) | **done** | c29 — feedSeverity from real text; alert pulseMul 2.2 + glyph is-alert |
| 20 | **Imagine zone densify** — add 1–2 more character/scene billboards for under-art constellations (GenerateImage→webp≤300KB) | **done** | c26 — scene-merge-beacon + scene-collab-tower webp billboards |
| 21 | **Star focus breadcrumb twin** — when a star is focused, mirror name+lane health beside last-palette crumb with Back to sky | **done** | c35 — FlyoverHud focus crumb + motion breadcrumb-ease (c8) |
| 22 | **Spend JSONL hook readiness** — document + adapter probe for future xAI usage append path (still honest empty until real USD events exist) | **done** | c43 — canonical spend.jsonl + tail/partial/malformed harden; **no real USD ledger on box** → honest empty |

| 23 | **Status-error last-good (Gap#1)** — keep last-good scene on status fail; calm stale chrome; backoff retry; never blank wipe | **done** | c27 — soft error overlay + lastData hydrate + exponential backoff; interior gated to fly.interior |
| 24 | **Idle interior drawer (Gap#2)** — keep INTERIOR collapsed until a building is focused | **done** | c27 — BuildingInteriorPanel mounts only when fly.level===interior |
| 31 | **Large-fleet crash + portrait 404 (Gap#11)** — cap/LOD scene bots; portrait fallback never broken image | **done** | c28 — MAX_SCENE_BOTS=48; ImagineNode wash + portrait-dashboard fallback; focus-ease + painter Imagine mats landed |
| 32 | **Slow status as pending not error (Gap#9)** — ignore StrictMode/unmount AbortError; first-load stays loading | **done** | c28 — aborted+stopped / first-load abort ignored |
| 33 | **Focus during flight (Gap#10)** — preserve latest selection; queue camera retarget until glide settles | **done** | c28 — onSelectBot always; pendingFocusBotId until acceptPointerPick |
| 25 | **Pan/drag remount splash (Gap#3)** — keep last WebGL frame across context-loss/remount; no full splash on pan | **done** | c30 — preserveDrawingBuffer + last-frame freeze; splash suppressed after stage primed |
| 26 | **Star hover tooltip + edge highlight (Gap#4)** — health/lane/branch/heartbeat tooltip; highlight constellation edges | **done** | c34 — dash3d-star-tooltip + edge opacity highlight on hover |
| 27 | **Constellation Filters/Groups drawer (Gap#5)** — search, orphans, lane/health groups beyond Operator filter | **done** | c35 — GraphFiltersPanel + dash3d-graph-filter → scene visibility |
| 28 | **N-hop / expand neighbors (Gap#6)** — local graph depth around focused star | **done** | c36 — nhopBotIds + depth slider; dash3d-nhop isolates stars/edges |
| 29 | **HUD focus mode / collapsible layers (Gap#7)** — one-gesture collapse Mirror/Feed/Charts/sky chrome | **done** | c37 — Focus stage toggle + F hotkey; data-hud-focus hides chrome |
| 30 | **Orientation minimap / compass (Gap#8)** — inset overview after zoom/pan | **done** | c39 — MinimapPanel + projectMinimap; click → focus bot |
| 35 | **Sparse status crash (Gap#12)** — `{"bots":[]}` / missing spend|notionGraph|weather must not take down the app | **done** | c30 — normalize sparse sections in status hook; optional-chain UI reads |
| 36 | **Persist last-good across reload (Gap#13)** — sessionStorage/IDB snapshot + stale-since banner when status outage on boot | **done** | c31 — sessionStorage last-good; hydrate ready+stale; skybar stale WAT banner |
| 37 | **Skip-link first + glyphs out of tab order (Gap#14)** — skip to skybar first; feed-glyph tabindex=-1; Feed list is keyboard path | **done** | c32 — skip link first in main; glyphs tabIndex=-1; skybar fallback target |
| 38 | **Charts readable ticks + values (Gap#15)** — non-truncated labels, inline top values, focusable marks / touch tooltips | **done** | c33 — chartTickLabel hour/initials; value labels; focusable marks + aria |
| 39 | **View state in URL (Gap#16)** — `?focus=&level=` shareable; Back zooms out via popstate | **done** | c40 — view-url parse/build; replaceState focus; pushState level; popstate |
| 40 | **Charts vs Star Detail overlap (Gap#17)** — node detail wins z-order / collapse charts when focused | **done** | c38 — node-detail z-index above charts when open |
| 41 | **Sanitize hostile bot names (Gap#18)** — strip bidi overrides; ellipsis + title on long names | **done** | c38 — bot-normalize stripBidi + dash3d-node-title |
| 42 | **Portrait negative cache (Gap#19)** — Star Detail onError → portrait-dashboard; no 404 storm | **done** | c38 — portrait-resolve session miss cache |
| 43 | **Dedupe duplicate bot ids (Gap#20)** — normalize status bots by id (newest heartbeat) | **done** | c38 — dedupeBotsById in status hook |
| 44 | **Hydration mismatch (Gap#21)** — no Date.now()/matchMedia/window during first paint; verified via cold loads | **done** | c53 Gap#65 — flyover matchMedia→useEffect; mount-after-hydrate lazy shell; hydration-safe guards |
| 45 | **Notion mirror readable times (Gap#22)** — unescape Markdown ISO; relative + WAT title | **done** | c40 — format-when + MirrorTitle |
| 46 | **200% zoom / short viewport reflow (Gap#23)** — stack panels; pin Operator | **done** | c40 — max-height media query in dashboard-3d.css |
| 47 | **Feed text ≥12px (Gap#24)** — raise feed/commit floors; title tooltips | **done** | c40 — max(12px) feed CSS + feed-row title |
| 48 | **Pause status poll when hidden (Gap#25)** — visibilitychange pause; refetch on visible | **done** | c40 — use-dashboard-status hidden gate |
| 49 | **Gap#36 mobile close under HUD** — raise detail z-index / relocate focus toggle so × is tappable at 390×844 | **done** | c44 — detail z-index 10; focus toggle moves left while open · was queued REA captures-20261101-223652 |
| 50 | **Gap#37 landscape detail unbounded** — max-height 100dvh + internal scroll for short viewports | **done** | c44 — max-height 100dvh + overscroll contain · was queued REA m844x390 |
| 51 | **Gap#38 touch-action / overscroll** — canvas touch-action:none; detail overscroll-behavior:contain | **done** | c44 — canvas touch-action:none; detail overscroll-behavior · was queued REA pinch/swipe |
| 52 | **Gap#42 live Star Detail** — refresh selected bot from latest status; close if bot gone | **done** | c44 — selected sync from status; close if bot gone · was queued REA Conductor stale |
| 53 | **Gap#44 Notion plain text in detail** — strip markup escapes in titles/excerpts (reuse Gap#22 helpers) | **done** | c44 — sanitizeNotionPlainText in graph + node-detail · was queued REA mobile Notion page |
| 54 | **Gap#43 art cache + lazy dive assets** — long-cache hashed art; defer building/backdrop until Dive | **done** | c45 — Dive-only city/interior/building; idle-deferred scene plates; vite+vercel Cache-Control; capture art 30→fewer |
| 55 | **Gap#41 skybar CLS / long tasks** — more reserved skeletons; defer constellation work off first paint | **done** | c45 — skybar/card min-heights; portrait idle queue; evidence captures-c45-cls |
| 56 | **Light — focus key/rim light + depth focus falloff (wire)** — `createFocusLight` (atmosphere/) + `createFocusDepthPass` (postfx/, after god-rays, before bloom) driven by `rig.subjectId` focused mesh + bot health | **done** | c44 — wired in universe-scene (after god-rays, before bloom; real health; DPR RT; dispose on unmount/context loss); Light lane 53f5ad1 was #49 |
| 58 | **Motion c16 follow-up — wire star-batch into universe tick** — adopt star-batch helper for botVis pulse/drift; keep camera dolly Dashboard-owned | **done** | c46 — ancestry 601a8be; `stepStarFieldBatch` in universe tick; cpu-budget+star-batch tests registered |
| 59 | **Attacker — status cold-cache / payload size** — re-check Gap#28-style slow status after bot cap; add timing badge if still >500ms | **done** | c46 — Gap#59 `slimDashboardStatusForPoll` default poll + `?bot=` / `?full=1`; lazy select fetch; timing badge still open if >500ms |
| 57 | **Light — focus-aware bloom guard** — while a node is focused, depth-mask bloom so Imagine portrait/card highlights inside the focus band don't haze over detail; background keeps tone bloom | **done** | c46 — land postfx from f2df35a; wire createFocusBloomGuard + context-loss focusBloomGuard; tests registered |
| 60 | **Gap#45 Mirror over Time + zoomout flex slabs** — skybar z-index above mirror; zoomout pills `align-self:flex-start` max 2.75rem | **done** | c46 — CSS only; elementFromPoint Time should hit scrubber |
| 61 | **Gap#46 Star Detail dialog a11y + skybar live region** — role=dialog, focus close on open; drop skybar aria-live | **done** | c46 — node-detail-panel + dashboard-app |
| 62 | **Gap#47 Portrait texture dispose on rebuild** — track owned Imagine maps; dispose on rebuild/unmount | **done** | c46 — ownedPortraitTextures in universe-scene |
| 63 | **Gap#48 Time scrubber drives Charts/Money/Forever (or honest Live note) + aria-valuetext** | **done** | c47 — aria-valuetext; charts rebuild at scrubMs; Money/Forever Live note |
| 64 | **Gap#49 Chart labels/tooltips still truncated (Gap#15 re-check)** | **done** | c47 — hour tick through ·c/r; role=tooltip text; lane legend |
| 65 | **Gap#50 Lock claims vs releases chart drops empty hours / claims-only bars** | **done** | c47 — zero-fill hours; cyan claims + amber releases altValue |
| 66 | **Gap#51 Compass minimap overlaps Charts at 1280×800** | **done** | c47 — charts bottom above minimap (calc +158px) |
| 67 | **Light — Imagine portrait colour bounce + detail-card backdrop dim (#60)** | **done** | c47 — land e65a052 atmosphere/postfx; wire createPortraitBounce + createDetailBackdropDimPass; ctx-loss harden+scene retry co-exist |
| 68 | **Light — measured-luminance backdrop dim** | **done** | c50 — land c57e111; wire setContrastTarget/setHidden; portrait lastSampleError stickiness; tests registered |
| 69 | **Gap#52 Canvas resize/rotation keeps first aspect** — host 100dvh + ResizeObserver client box | **done** | c48 — CSS absolute fill; removed relative wrap override; RO on mount |
| 70 | **Gap#53 Canvas accessible name** — role=img + live aria-label from bot health/weather | **done** | c48 — dash3d-stage-canvas |
| 71 | **Gap#34 re-check — hide tab money burn + clear gap** | **done** | c49 — warn on suppress; clear hiddenGapMs after 25s visible; tests |
| 72 | **Surfaces — lock history + chart drilldown + fly focus crumb** | **done** | c49 — timeline lock history; chart→bot/scrub; fly focus name/task |
| 73 | **Motion c17 — health-pulse-crossfade + star-batch harden** | **done** | c50 — land fc36a5e motion/; wire crossfade + STAR_BATCH_MAX/ORBIT_OPTS |
| 74 | **Motion c18 — neighbor-drift-damp + alloc-budget** | **done** | c50 — neighbor damp after batch; alloc-budget via --expose-gc |
| 75 | **Gap#10 focus mid-flight** — queue focus requests while camera flies; latest wins; unknown bot clears stale detail | **done** | c51 — preferRetarget mid-glide; focus-request helper + tests | 
| 79 | **Light — #79 per-panel backdrop dim** | **done** | c51 — land f3b1c41; per-rect setContrastTarget array; meter-sample-age + detail-dim-per-rect |
| 80 | **Light — #80 meter readback cost guard** | **done** | c51 — land fd3656b (no extra wiring); meter-backoff test |
| 81 | **Motion c19 — star-batch xfade+neighbors one-call** | **done** | c51 — land 37333fd; pass xfade/neighbors opts; renumbered (Motion tip said #79, Light owns #79) |
| 82 | **Motion c20 — edge pulse flip + pruneMotionStateMap** | **done** | c51 — prune on bot-list change; edge-pulse-flip + state-prune tests |
| 83 | **Gap#58 Notion href allowlist** — https only; notion.so / www / app.notion.com / *.notion.site; neutralize js/data/http | **done** | c52 — sanitizeNotionHref in parse + Star Detail |
| 84 | **Gap#57 Escape focus restore** — blur hidden close; restore to opener/canvas host; inert when closed | **done** | c52 — restoreFocusAfterDetailClose + canvas host tabIndex |
| 85 | **Gap# empty Notes / Lock commits honesty** — surface real notes+lock.commits when present; keep no-source when absent | **done** | c53 — composeBotNotes + sanitizeLockCommitLines + known branches git log |
| 86 | **Hostile Notion title sanitize in Star Detail** — show plain text only (already sanitizeNotionPlainText); verify no raw <b> in panel | **queued** | gap-feed #44 follow-up / attacker |
| 87 | **Scene: focus restore visible ring** — canvas-host :focus-visible outline when Escape returns keyboard to stage | **done** | c52 — dashboard-3d.css :focus-visible on dash3d-canvas-host |
| 88 | **Gap Dispatcher #59 — WebGL context-loss black screen** — honest overlay “3D view paused — graphics context lost, restoring…” + retry when restore fails | **done** | c52 — showContextLossOverlay + universe-scene preventDefault/restore/retry |
| 89 | **Gap Dispatcher #60 — Focus stage chip covers System weather** — reserve skybar padding; chip stays clear of title | **done** | c52 — .dash3d-skybar padding-right 9.5rem |
| 90 | **Gap Dispatcher #61 — Compass dots clumped** — deterministic spread by real lane/bot data | **done** | c52 — minimap auto-span + lane/id de-overlap |
| 91 | **Light #83 — Imagine key lift + meter badge wired** — createSceneKeyLiftPass after detailDim; badge behind ?dash3dDebug=1; hidden-tab suspend from 4496632 | **done** | c52 land postfx from 4496632 + universe-scene wire; tests registered |
| 92 | **Light #84/#92 — meter focused Imagine card rect + liftBackdrop** — setCardProbe(true) in rebuild; liftBackdrop prefers card; bf1ca41 target align | **done** | c53 land e046153 postfx + universe-scene wire; card-probe + dim-target-align tests |
| 93 | **Motion c21 traveler trails wired** — stepTravelerTrails + focus-churn resume; register tests | **done** | c53 land ab17f6f + universe-scene wire |
| 94 | **Bot surfaces: Recent/Lock commits + Queue + Notes from real sources** — known branches git log (cached); lane INTEGRATION queue; notion titles | **done** | c53 bot-branches + status enrich; attacker on git/queue |
| 95 | **Hostile Notion title sanitize in Star Detail** (was #86) | **queued** | attacker follow-up |
| 96 | **Gap Dispatcher #62 — Charts trust raw values** — coerce finite ≥0; compact labels; no NaN SVG | **done** | c53 SparkBars finiteChartValue + formatCompact |
| 97 | **Gap Dispatcher #63 — Dense chart series overflow** — window last 28 visible marks; no invisible Tab stops | **done** | c53 CHART_VISIBLE_MAX window |
| 98 | **Gap Dispatcher #64 — Chart focus tooltip** — shared visible tip on :focus-visible (not 1×1 foreignObject) | **done** | c53 chart-focus-tip |
| 99 | **Perf — dynamic import shell** — lazy DashboardApp / UniverseScene / ChartsPanel; deferred health-sound; glass Suspense shell | **done** | c53; no vite.config / vercel.json edits (Grok Build owns) |
| 100 | **Light #93 — card edge separation** (light @f9505c4 + hacker @ac2c946) | **wired** (Dashboard c53 498c945: createCardEdgePass + setCardSurround in universe-scene; card-edge + probe-radius-honest tests registered) | Light verified in merged tree; Dashboard Bot owns the done mark |
| 101 | **Motion c22 — comet reconcile + character re-entry wired** — reconcileCometLaunch(shas); cometHeadSize; reduced-motion exit amp ramp | **done** | c53 land af715e6/ec9cb41; comet-churn.test registered |
| 102 | **Light — Charts depth plate from measured backdrop spread** | **wired** | c55 land f3918db + universe-scene plate wire; projectedRadiusUv real-radius hacker; tests registered |
| 103 | **Light — #93 edge-mode hysteresis + measurement-age fade** — ±0.05 hyst (`edgeModeFromPeak` past 0.40/0.30) + `edgeAgeFade` on contrast.card.atMs (0 near METER_MAX_AGE); no universe-scene change | **wired** | c56 universe-scene setSeparation nowMs |
| 104 | **Motion c23 — comet sync wired** — `syncCommitComets` in 5s sync (no dispose/recreate churn); register particles/comet-sync.test.ts | **wired** | c55 land 81ded57 (content-identical tip f190cd2) + universe-scene wire |
| 105 | **REA d — overlay pointer-events + Operator Close + Zoom to sky** | **done** | c55 component CSS + onSkyEvent force reset + tests |
| 106 | **Cloud-storage mandate (partial)** — glass shell first; heavy Three/charts/sound lazy chunks; signed-URL host plug awaits Grok Build | **partial** | c55 verified universe-scene chunk separate from entry; no invented URLs |
| 107 | **Light — god-ray / bloom DPR resize rebind** — `createPostfxViewportRebind` (renderer→composer DPR+size→bloom device px→god-rays/focus-depth/bloom-guard depth rebind; dedupe on size AND dpr) + `watchDevicePixelRatio` + charts-depth-plate CSS-px uniforms follow live viewport every setPlate | **wired** | c56 universe-scene postfxRebind + DPR watch; viewport-rebind.test registered |
| 108 | **Motion c24 — applyCometLaunchSamples wired** — replace per-frame `getObjectByName` comet loop with `applyCometLaunchSamples(comets, samples, reduced)`; handle.lines/heads cached; register particles/comet-apply.test.ts + traveler-holes + null-opts | **queued** | Motion c24 (Dashboard wires universe-scene) |
| 109 | **Light — god-ray adaptive tap budget by drawing-buffer size** — `postfx/god-ray-budget.ts`: `godRayTapsFor(bufW,bufH)` (48 taps ≤2.5 MP, px×taps held at reference above, floor 16), `godRayTapParams` re-bases per-tap decay + exact energy norm (uniform-field energy identical at 48/40/32/24/16 → no brightness pop; reach/density unchanged), `createGodRayBudget` frame-time EMA backoff w/ hysteresis (>22 ms ×45 → down a tier, <17.5 ms ×180 → up; tab-hidden/junk deltas ignored). God-ray pass self-reads `readBuffer.width/height` + composer delta each render (**no scene wiring needed**); `rebindPostfxViewport` also calls `godRays.setBufferSize`. Hacker c108: `postfxViewport(..., maxEdge)` clamps buffer to GPU maxTextureSize (7680×2160@DPR2 asked 13440 px → incomplete FBO). Harness 2560×1440: 48→32 taps, mean luma 19.76→20.27, swiftshader frame 818→610 ms | **wired** | c57 FF 9f96493/2473e86; tests registered (auto-fed, no scene call-site) |
| 110 | **Light — bloom chain resolution budget by drawing-buffer size** — UnrealBloomPass mip-0 is buf/2 (≈2.8 MP at 4K/retina@1.75); cap bloom internal res at ~1.25 MP mip-0 above 2.5 MP buffers with radius/strength compensation measured so glow footprint on Imagine nodes + chart plates is unchanged; share the #109 frame-time tier | queued | Light lane next; postfx/bloom-tuning.ts only |
| 76 | **Gap#54 Star Detail keyboard modal** — Escape close, focus trap, restore focus, empty-sky dismiss | **done** | c51 — dialog Escape/Tab trap + focus restore |
| 77 | **Gap#55 N-hop controls for all bots** — move out of Notion-only branch; controlled depth value | **done** | c51 — nhop outside Notion; controlled nhopDepth |
| 78 | **Gap#56 lane vs bot health labels** — disambiguate "healthy" bot vs stalled lane rollup | **done** | c51 — lane health line + drivers |
| 111 | **Motion c25 — star focus still-target wired** — `stepFocusStillTarget` + star-batch `{ stillTarget: true }` (orbit radialAmp/bobAmp × driftMul → still at base; pulse 1.25×); register focus-still-target.test.ts + comet-stale-cache.test.ts | **wired** | c57 stillTarget:true + focus-still-target/comet-stale-cache tests registered |



## After each upgrade
1. Commit + push `origin/dashboard-3d` (never main, no force).
2. Append stop-point to Notion `40b1aa27632381768d58cde0731f142a` (fallback `40bb95f33e42814aacf8c3281b4f528d`) with exact text, SHA, results, next justified task.
3. Update this file (status + next researched item so queue never empties).
4. Report at least every **two** upgrades.

## Next researched (tail — keep non-empty)

- **Motion c26 — reduced-motion comet/launch freeze audit** — REA c24/c25 reduced uniqueSamples>1: ensure launch ease + dust/gust/edge-pulse write zero deltas under prefers-reduced-motion (static marks only); add probe test that motion helper outputs are stable across 60 frames when reduced=true (Cosmos Motion Bot next).

- **c48 attacker rank (2026-11-01 ~23:24 WAT):** resize+aria OK; status slim ~111KB. Next: land Light **#68** when pushed; then re-verify Gap **#34** (tab-hidden money/MotionClock stale) if still live; no new P0 from c48 attack.
- ~~**Operator last-node breadcrumb**~~ — promoted to queue #14.
- ~~**Real-data charts panel**~~ — **done c15**: SVG sparks for commits/bot, lock claims/hour, landings/lane, spend (honest empty).
- **Spend JSONL writer in xAI adapter** (researched c14) — when live usage returns cost/USD, append allowlisted `/workspace/audit/dashboard-3d/spend.jsonl` so Money panel lights up without inventing numbers.
- **Feed severity tint** (researched c13) — glyph accent by kind already; next: pulse faster when Merge Gate notes mention blocked/main, still real-text only.
- **City night-shift windows from lock timestamps** (Dashboard next after #4 Sound, or earlier if Sound blocked) — window glow per floor flickers on only for floors whose task/lock changed in the last 30 min (real claimed_at/released_at), so the city shows *where work is happening now*; static when no recent activity; reduced-motion = steady.
- **Star focus breadcrumb in Flyover HUD** (researched c9) — when a star is focused (`rig.subjectId`), show its name + lane health in the Flyover HUD with a "Back to sky" twin of Zoom to sky; keeps keyboard users oriented without opening the side card.
- ~~**Motion LOD / visibility budget**~~ — **done (Cosmos Motion Bot c3)**: camera-distance dust LOD via `onBeforeRender`, frame-budget governor (EMA >24ms trims to 30% floor, recovers <18ms), active-slice instance upload, `document.hidden` pause; plus shared continuous `MotionClock` (no teleport on tab resume / 24h fold).
- ~~**Motion — comet tail fade**~~ — **done (Cosmos Motion Bot c4)**: additive vertex-color head→tail gradient + soft head sprite (shared, refcounted, 2s grace so the 5s rebuild never re-uploads); reduced-motion = dim static. Hacker c4: MotionClock per-time-base anchors (no 2× speed with two time bases) + stutter cap (no freeze at <4fps).

- ~~**Painter — ink-wash constellation edge ribbons**~~ — **done (Cosmos Painter Bot c3)**: `InkWashEdgeMaterial` + `buildInkWashRibbon`; mediump time wrap; release on rebuild.
- ~~**Painter — Imagine node cards**~~ — **done (Cosmos Painter Bot c4)**: `ImagineNodeMaterial` watercolor edge bleed + paper-grain overlay + brush frame + missing/loading wash fallback; context-restore `rebindPainterlyKitTextures` + `bindSharedTexture` for star/paper consumers.
- ~~**Painter — lore plaque text atlas**~~ — **done (Cosmos Painter Bot c5)**: `createLoreTextAtlas` + `uTextMap` on lore plaque; Imagine texture sanitize (dims/NPOT/MAX_TEXTURE_SIZE/taint + explicit `imagineMapError`).
- ~~**Painter — post-pass health amount**~~ — **done (Cosmos Painter Bot c6)**: `painterlyAmountFromHealth` / `kit.setPassHealth({ healthy, total })`; resize/DPR clamp + RT-skip + compile fallback.
- ~~**Painter — bot star one-line adopt**~~ — **done (Cosmos Painter Bot c7)**: `kit.createBotStar` watercolor+glow (replaces MeshStandardMaterial); kit StrictMode listener detach; tick try/catch; mediump precision. Next: Dashboard Bot adopt createBotStar + setPassHealth; ink-wash edges still LineDashed.
- ~~**Painter — batched ink-wash edge adopt**~~ — **done (Cosmos Painter Bot c8)**: `kit.createInkEdges(edges)` / `update` / `dispose` — ≤4 draws by health, degenerate/NaN/flood skip+cap; replaces LineDashed. Next: Dashboard Bot wire in `rebuildEdges`.
- ~~**Painter — lane nebulae + texture budget**~~ — **done (Cosmos Painter Bot c9)**: `kit.createLaneNebulae` watercolor lane clouds (replaces MeshBasic); `kit.textureBudget()`; Imagine post-release load race hardened. Next: Dashboard Bot wire createLaneNebulae + createInkEdges.
- ~~**Painter — city window washes + reduced-motion tick**~~ — **done (Cosmos Painter Bot c10)**: brush-building `uWindowGlow` from real progress; `tickPainterlyKit(..., { reducedMotion })`; nebula flood/NaN + shared ≤4 mats. Next: Dashboard Bot pass reducedMotion into tickPainterlyKit; wire createLaneNebulae.
- ~~**Painter — unified post-pass palette + resize storm**~~ — **done (Cosmos Painter Bot c11)**: warm/cool paper grade in painterly pass (amount from real health); resize storm coalesce + contextLost resize guard; nebula dispose idempotent. Next: Dashboard Bot `tickPainterlyKit(kit,t,{reducedMotion})` + live `setBuildingProgress`.
- ~~**Painter — star brush-stroke status halos**~~ — **done (Cosmos Painter Bot c12)**: `uHalo` on WatercolorStarShader via createBotStar (idle/active from real status); Imagine disposed-texture + kit HMR disposeAll/budget harden. Next: optional reducedMotion freeze-tick without skipping block.
- ~~**Painter — ink-edge watercolor bleed + star color sanitize**~~ — **done (Cosmos Painter Bot c13)**: `uBleed` from real health/kind/weight on createInkEdges; sanitizePainterColor (no white-on-invalid); star forceFallback compile path; paintWrap mediump clamp. Next: optional edge `weight` from scene activity.
- ~~**Painter — lane nebula pigment pooling + disposed-kit guards**~~ — **done (Cosmos Painter Bot c14)**: `uPool` from real lane health on createLaneNebulae; mesh pool under lane flicker; create* after dispose throws `painterly-kit-disposed`; wrap-seam-safe nebula time orbit. No extra wiring.
- ~~**Painter — post-dispose fail-safe + star pigment granulation**~~ — **done (Cosmos Painter Bot c15)**: create/bind after dispose return inert no-ops + `disposeMeta` (no live-dashboard throw); star `uGrain` from real health/`idle` + anisotropic paintWrap grain. Optional: pass `health: bot.health` into createBotStar.
- ~~**Painter — paper-grain fiber direction in painterly post-pass**~~ — **done (Cosmos Painter Bot c16)**: anisotropic `fiber` on PainterlyPassShader from real setPassHealth amount; NaN uniform scrub each tick; empty lore atlases use LORE_ATLAS_MIN. No extra wiring.
- ~~**Painter — building façade dry-brush from real progress**~~ — **done (Cosmos Painter Bot c17)**: `uDryBrush` from real setBuildingProgress; WebGL1 building fallback; texture budget soft-cap degrades grain/fiber; `createBuildingBrushPool` ≤8 shared mats. Optional city adopt pool.
- ~~**Painter — Imagine missing-art wash keyed by real bot lane**~~ — **done (Cosmos Painter Bot c18)**: `imagineWashFromLaneHealth` / `uLoading`; stale-generation TextureLoader race; pool tombstone after dispose; budget degrade hysteresis. Optional: pass `lane`+`health`+`loading` into createImagineNodeMaterial; use beginImagineNodeMapBind for async loads.
- ~~**Painter — lore plaque ink density from real lock age**~~ — **done (Cosmos Painter Bot c19)**: `uInkDensity`+`uPaper` from real `claimed_at`; malformed/future/TZ skew sanitized; `setLorePlaqueNotesCached` stops heartbeat atlas churn. Optional: pass `claimedAt` + use cached notes binder on poll.
- **Painter — constellation plaque stack z-fight harden** — next: plaque `depthWrite`/polygonOffset/renderOrder helpers when many lore cards overlap at a star; honest skip when no plaque.
- ~~**Depth-aware god-ray shafts**~~ — **done (wired c9)**: god-ray pass + depth RT in universe-scene.
- ~~**Health-reactive exposure ride**~~ — **done (wired c9)**: `createExposureRide` in universe-scene; idle until data; reduced-motion snaps.
- **Pairing beacon** — HP Pairing star becomes a lighthouse sweep when a paired PC heartbeat appears (env/agent URL); honest dark when absent.

## Visual Fleet

Parallel polish bots land into `dashboard-3d` only while holding `dashboard-3d.lock`.

| Bot | Lane lock | Branch | Paths (only) |
|-----|-----------|--------|----------------|
| Cosmos Painter Bot | `dashboard-3d-visual-painter.lock` | `dashboard-3d-visual-painter` | `src/components/mind/dashboard-3d/shaders/`, `materials/` |
| Cosmos Light Bot | `dashboard-3d-visual-light.lock` | `dashboard-3d-visual-light` | `atmosphere/`, `postfx/` |
| Cosmos Motion Bot | `dashboard-3d-visual-motion.lock` | `dashboard-3d-visual-motion` | `motion/`, `particles/` |

Rules:
1. **Main queue head has priority** over fleet polish when both need the shared worktree.
2. Fleet **never** edits files outside its lane folders (or its own lock).
3. Fleet bots appear as stars in the **Visual Fleet** constellation; health comes from their lane lock (no lock ⇒ idle).
4. Hold `dashboard-3d.lock` only while actively merging/editing the shared worktree; **release between milestones** so fleet can land.

## c18 content gaps (2026-11-01 ~20:42 WAT)
Filled: detail branch commits (bot/branch map), bot-health + commits/day charts, spend empty-chart frame, 20s status poll, build-time commits snapshot for Vercel, larger portrait + character planes + Imagine scene billboards (`scene-operator-character.webp`, `scene-agents-walk.webp`), building interior portrait. Spend remains honest empty (no real USD ledger). See `/workspace/audit/dashboard-3d/c18-gaps.md`.


## c19 content pass (2026-11-01 Africa/Lagos)
- Mirror lock fallback for cosmos lanes; interior bot fallback; 3 new Imagine scene webps; chart labels; commits snapshot refresh.
- Spend still no source yet. Zoom+feed verified.

## c20 hacker + guard (2026-11-01 Africa/Lagos)
- Hacker: old single-regex queue parser silently dropped any row without " — detail" or with an em dash inside the bold title (rows 11–13 vanished; a `| 18 | **X** | queued |` row was invisible → forever guard/sky road under-reported). Now cell-based, 512 KB / 200-row caps, index dedupe; queue file missing (Vercel) ⇒ "Queue source unavailable" (tone unknown), never a false red breach; no absolute path leaked to client. Log: `/workspace/audit/dashboard-3d/c20-hacker.md`.
- Shipped #10 Forever-contract panel in skybar (c17 WIP), next-4 queued list, lanes needing next task.
