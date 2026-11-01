# Dashboard forever-contract upgrade queue

## Cadence (Zack 2026-11-01)

2-hour interval **removed**. Dashboard Bot + visual fleet (Painter/Light/Motion) run **continuously**, back-to-back. After each landing, start the next cycle immediately. **5-minute safety restart** skips if a cycle is already running (no-ops while the lane lock is claimed). Report to parent every **two** upgrades.

Last release: Dashboard c21 — Operator last-node breadcrumb (#14) + lastNodeId sanitize hacker. Next: #15 Mobile / touch pass.

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
| 15 | **Mobile / touch pass** — larger skybar hit targets, touch-friendly operator open, safe-area padding | queued | REA gap #20 Mobile/PWA (`gap-list-2026-11-01.md`); dashboard touch vs ChatGPT/Gemini public install polish |
| 16 | **Accessibility pass** — focus rings, aria on forever/operator, skip-link to skybar | queued | REA keyboard shortcut sheet gaps (c2–c4 open); a11y for glass HUD |
| 17 | **Perf budget at 18+ bots** — frame/draw hint when bot count ≥18; pause nonessential CSS2D under budget miss | queued | REA + Motion LOD precedent; 18-bot constellation stress |
| 18 | **City night-shift windows** — per-floor window glow only for floors whose lock changed in last 30 min (real claimed_at/released_at); steady under reduced-motion | queued | promoted from tail c20; shows where work is happening now |
| 19 | **Feed severity pulse** — pulse sky-feed glyphs faster when Merge Gate / lock notes mention blocked/main (real text only) | queued | researched c13; no invented severity |
| 20 | **Imagine zone densify** — add 1–2 more character/scene billboards for under-art constellations (GenerateImage→webp≤300KB) | queued | content priority; reuse public/dashboard-3d/art when present |

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
- **Painter — lore plaque text atlas** — procedural canvas glyph atlas for lock-note body text on plaques (no external fonts/assets) (next painter cycle).
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
