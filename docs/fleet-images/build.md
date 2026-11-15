# Build surface marks

Preview: `http://127.0.0.1:8080/` with Build open (header title “Build”). `command-app.tsx` was not edited, so these files are not wired in. Not committed. Not deployed.

## Letter tiles

None on this surface. `build-panel.tsx` and `build-workspace.tsx` paint no one-letter or two-letter glyph. The shortest chip is the word All.

## No icon

Build panel (`build-panel.tsx`):

- Page title **Build** (`#build-panel-title`) is text only. The top bar already uses `/public/brand/marks/build.png`. Not regenerated.
- Action chips **Check computer, then show the next step**, **Show the next step for this setup**, **Show how to keep edits off**, and **Approval reminder is on**.
- Target chips **Plan only**, **Hosted attempt**, **Paired computer**.
- Scope chips **Explain only**, **One file**, **This folder**.
- Filter chips **All**, **Plan**, **Edit**, **Review**, **Terminal**, **Saved**.
- Kind labels **Plan**, **Edit**, **Review**, **Terminal** are uppercase text, not tiles.
- Row buttons **Use this line next** and **Save**.

Build workspace (`build-workspace.tsx`):

- **Plan with Grok** is text only. `/public/brand/marks/grok.png` is not used here. Not regenerated.
- **Search**, **Register workspace**, **Send transcript**, **Read result**, and **Save profile** are text buttons.
- The **kimi-k2** model field is text only.
- Status pill **Hosted attempt on submit** is text only.
- **Kimi runtime capabilities** (`kimi-phase4-panel.tsx`) is text only. It is inside the Capabilities panel, not the default view.

## Already iconed

Refresh, Companion online/offline, Browse, Run with Kimi, and Honest runtime boundary use Lucide icons. Adrian Build uses a Lucide terminal, not a letter. Panel rows Agent, Changes, Editor, and Terminal use Lucide icons. Timeline and Capabilities reuse that same terminal icon, so they are not letter tiles and not iconless. Not regenerated.

## Saved (cap of two)

Generated with grok-imagine-image-2.0, quality low, aspect ratio 1:1, then resized to 128×128 PNG.

- `/public/brand/marks/kimi.png` — pale crescent and star, for the kimi-k2 field and the Kimi runtime heading.
- `/public/brand/marks/plan.png` — ice-blue three-dot path, for the Plan kind label, the Plan filter, and Plan with Grok.

Other text chips were left without files because of the cap of two.
