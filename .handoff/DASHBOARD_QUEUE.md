# Dashboard forever-contract upgrade queue

## Cadence (Zack 2026-11-01)

2-hour interval **removed**. Dashboard Bot + visual fleet (Painter/Light/Motion) run **continuously**, back-to-back. After each landing, start the next cycle immediately. **5-minute safety restart** skips if a cycle is already running (no-ops while the lane lock is claimed). Report to parent every **two** upgrades.

Last release: Dashboard c42 — Gap#29 publicize+405 + Gap#28 server TTL/single-flight + Motion 831225f (motion/+particles/, skip package.json) + Painter c10 94c28c7. Next: probe-ranked gaps + fleet tips.


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
| 22 | **Spend JSONL hook readiness** — document + adapter probe for future xAI usage append path (still honest empty until real USD events exist) | queued | researched c14; never invent numbers |

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
| 44 | **Hydration mismatch (Gap#21)** — no Date.now() during SSR render; client clock after mount | **done** | c40 — nowMs state set in useEffect |
| 45 | **Notion mirror readable times (Gap#22)** — unescape Markdown ISO; relative + WAT title | **done** | c40 — format-when + MirrorTitle |
| 46 | **200% zoom / short viewport reflow (Gap#23)** — stack panels; pin Operator | **done** | c40 — max-height media query in dashboard-3d.css |
| 47 | **Feed text ≥12px (Gap#24)** — raise feed/commit floors; title tooltips | **done** | c40 — max(12px) feed CSS + feed-row title |
| 48 | **Pause status poll when hidden (Gap#25)** — visibilitychange pause; refetch on visible | **done** | c40 — use-dashboard-status hidden gate |



## After each upgrade
1. Commit + push `origin/dashboard-3d` (never main, no force).
2. Append stop-point to Notion `40b1aa27632381768d58cde0731f142a` (fallback `40bb95f33e42814aacf8c3281b4f528d`) with exact text, SHA, results, next justified task.
3. Update this file (status + next researched item so queue never empties).
4. Report at least every **two** upgrades.

## Next researched (tail — keep non-empty)
- ~~**Operator last-node breadcrumb**~~ — promoted to queue #14.
- ~~**Real-data charts panel**~~ — **done c15**: SVG sparks for commits/bot, lock claims/hour, landings/lane, spend (honest empty).
- **Spend JSONL writer in xAI adapter** (researched c14) — when live usage returns cost/USD, append allowlisted `/workspace/audit/dashboard-3d/spend.jsonl` so Money panel lights up without inventing numbers.
- **Feed severity tint** (researched c13) — glyph accent by kind already; next: pulse faster when Merge Gate notes mention blocked/main, still real-text only.
- **City night-shift windows from lock timestamps** (Dashboard next after #4 Sound, or earlier if Sound blocked) — window glow per floor flickers on only for floors whose task/lock changed in the last 30 min (real claimed_at/released_at), so the city shows *where work is happening now*; static when no recent activity; reduced-motion = steady.
- **Star focus breadcrumb in Flyover HUD** (researched c9) — when a star is focused (`rig.subjectId`), show its name + lane health in the Flyover HUD with a "Back to sky" twin of Zoom to sky; keeps keyboard users oriented without opening the side card.
- ~~**Motion LOD / visibility budget**~~ — **done (Cosmos Motion Bot c3)**: camera-distance dust LOD via `onBeforeRender`, frame-budget governor (EMA >24ms trims to 30% floor, recovers <18ms), active-slice instance upload, `document.hidden` pause; plus shared continuous `MotionClock` (no teleport on tab resume / 24h fold).
- ~~**Motion — comet tail fade**~~ — **done (Cosmos Motion Bot c4)**: additive vertex-color head→tail gradient + soft head sprite (shared, refcounted, 2s grace so the 5s rebuild never re-uploads); reduced-motion = dim static. Hacker c4: MotionClock per-time-base anchors (no 2× speed with two time bases) + stutter cap (no freeze at <4fps).
- **Motion — focus-aware star easing** — selected/hovered star eases to a 1.25× pulse + orbit-drift damped to 0 near the focused star so click-and-zoom (#2) lands on a still target; exposes `focusId` input, reduced-motion = instant (Cosmos Motion Bot next).

- ~~**Painter — ink-wash constellation edge ribbons**~~ — **done (Cosmos Painter Bot c3)**: `InkWashEdgeMaterial` + `buildInkWashRibbon`; mediump time wrap; release on rebuild.
- ~~**Painter — Imagine node cards**~~ — **done (Cosmos Painter Bot c4)**: `ImagineNodeMaterial` watercolor edge bleed + paper-grain overlay + brush frame + missing/loading wash fallback; context-restore `rebindPainterlyKitTextures` + `bindSharedTexture` for star/paper consumers.
- ~~**Painter — lore plaque text atlas**~~ — **done (Cosmos Painter Bot c5)**: `createLoreTextAtlas` + `uTextMap` on lore plaque; Imagine texture sanitize (dims/NPOT/MAX_TEXTURE_SIZE/taint + explicit `imagineMapError`).
- ~~**Painter — post-pass health amount**~~ — **done (Cosmos Painter Bot c6)**: `painterlyAmountFromHealth` / `kit.setPassHealth({ healthy, total })`; resize/DPR clamp + RT-skip + compile fallback.
- ~~**Painter — bot star one-line adopt**~~ — **done (Cosmos Painter Bot c7)**: `kit.createBotStar` watercolor+glow (replaces MeshStandardMaterial); kit StrictMode listener detach; tick try/catch; mediump precision. Next: Dashboard Bot adopt createBotStar + setPassHealth; ink-wash edges still LineDashed.
- ~~**Painter — batched ink-wash edge adopt**~~ — **done (Cosmos Painter Bot c8)**: `kit.createInkEdges(edges)` / `update` / `dispose` — ≤4 draws by health, degenerate/NaN/flood skip+cap; replaces LineDashed. Next: Dashboard Bot wire in `rebuildEdges`.
- ~~**Painter — lane nebulae + texture budget**~~ — **done (Cosmos Painter Bot c9)**: `kit.createLaneNebulae` watercolor lane clouds (replaces MeshBasic); `kit.textureBudget()`; Imagine post-release load race hardened. Next: Dashboard Bot wire createLaneNebulae + createInkEdges.
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
