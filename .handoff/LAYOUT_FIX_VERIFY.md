# LAYOUT_FIX_VERIFY — Adrian's Mind (logic-layout-fix)

**Branch:** `logic-layout-fix` (from `origin/logic-research-deep` @ `7491b92`)  
**Worktree:** `/workspace/logic-layout-wt`  
**Author:** emzylavish-art \<emzylavish@gmail.com\>  
**When:** 2026-11-02 America/Chicago  

## Complaint (Zack iPhone recording)

Page felt "scattered": Memory sheet actions untappable; fixed bottom nav covering content; ASK / AUTOMATIC / Memory: OFF crammed; header VOICE / IDLE / SWITCH TO ORCHESTRA + icon cluster fighting for space.

**Bottom nav identity:** The Chat / Bots & Agents / + / Build / Projects / More bar in the video is **Adrian's Mind's own** `nav[aria-label="Primary"]` (`.mobile-primary-nav`). The iOS in-app browser chrome (back/forward/share/tabs) sits *below* it and was not changed.

## Defects → cause → fix

| # | Defect | Cause | Fix |
|---|--------|-------|-----|
| 1 | Memory sheet Cancel/Enable only show top edges; untappable | Overlay was `z-40`; CSS forced mobile nav to `z-index: 40 !important` and nav is *after* Overlay in DOM, so nav painted on top of sheet actions. Also no `dvh` max-height / sticky footer / safe-area on the sheet. | `Overlay` → `z-[60]`, `data-sheet="open"`, flex column, scrollable body, sticky `.overlay-panel__actions` with `padding-bottom: calc(0.75rem + env(safe-area-inset-bottom))`. CSS hides/lowers `.mobile-primary-nav` (and live-voice/composer chrome) while any `[data-sheet="open"]` / `.overlay-backdrop` / shortcut sheet is open. Same pattern for project + approval sheets. |
| 2 | Fixed bottom nav overlays page content | Content clearance incomplete vs nav height; idle composer sticky/`max-height` crush rules pulled siblings under the dock. | `--mobile-primary-nav-height` + `.main-stage` padding `nav + safe-area`; idle composer kept in normal flow on mobile (no sticky over siblings). Nav keeps safe-area padding. **Click handlers untouched.** |
| 3 | ASK / AUTOMATIC / Memory row crammed; OFF→ON label shift | Cycle 32/34 CSS forced `flex-flow: row nowrap`, ~2–3rem height caps, and tiny gaps on `.grid.gap-2`. | Row is `flex flex-wrap gap-2` with `data-testid="autonomy-memory-row"`; Memory toggle fixed `13.5rem` width (`tabular-nums`); crush-override CSS unlocks wrap + 44px min targets. |
| 4 | Header VOICE / icons overflow / shift | Topbar lacked wrap; switch label width not reserved; touch targets \<44px. | `flex-wrap` on `.topbar`; VoiceModeBadge switch `min-h-11 min-w-[9.5rem]`; status min-width; voice-zone wraps with gap. |

Also audited: shortcut sheet (`data-sheet="open"`, max-height dvh, safe-area padding), voice-mode overlay (`z-[60]` + `data-sheet`), project/approval overlays (same Overlay footer pattern).

## Quality gate

- `npx tsc --noEmit` — clean  
- `npm run test:mind` — **1842 pass / 0 fail**  
- `npm run build` — green  
- `node scripts/layout-overlap-check.mjs --base http://127.0.0.1:4173 --label after` — **PASS** (20/20 assertions)

## Overlap-check (per viewport)

Script: `scripts/layout-overlap-check.mjs` (`npm run test:layout-overlap`). Opens home, Memory sheet, Project sheet, Shortcut sheet. Asserts each action button is fully in the viewport and `elementFromPoint(centre)` resolves to that button.

| Viewport | Result |
|----------|--------|
| 390×844 (iphone14) | PASS |
| 375×667 (iphoneSE) | PASS |
| 430×932 (iphone14proMax) | PASS |
| 1280×800 (desktop) | PASS |

Report JSON: `/workspace/audit/layout-scatter/shots/after-overlap-report.json`

## Screenshots

Under `/workspace/audit/layout-scatter/shots/`:

- **Before (from Zack video):** `before-home-from-video.jpg`, `before-memory-sheet-from-video.jpg`  
- **Before (local broken):** `before-home-iphone14.png`, `before-memory-sheet-iphone14.png`, …  
- **After:** `after-home-{iphone14,iphoneSE,iphone14proMax,desktop}.png`, `after-memory-sheet-*.png`, `after-project-sheet-*.png`, `after-shortcut-sheet-*.png`

## Left for Visual Polish / Grok Build

- Pixel-level glass/typography polish on the autonomy tiles and header icon cluster (Logic fixed overlap/tap geometry; visual rhythm still dense on 375-wide).  
- Idle composer “Speak” bar vs primary nav vertical stacking aesthetic (nav no longer steals sheet taps; Visual Polish can restyle the dual docks).  
- Optional: promote Overlay into a shared `ActionSheet` component used by dashboard-3d dialogs.  
- Live iPhone safe-area confirmation on a physical device / TestFlight WebView (Playwright has no `env(safe-area-inset-*)` by default; CSS is wired).

## Stop point

SHA: `b72779ae49034653aff34ae92d09da2d3bab1ec2`. Next: Visual Polish pass on density; Merge Gate when ready. Do **not** deploy prod from this branch.
