# Explore surface marks

Preview: `http://127.0.0.1:8080/explore` (title “Explore”). `command-app.tsx` was not edited, so these files are not wired in. Not committed. Not deployed.

## Letter tiles

None on this surface. No one-letter or two-letter glyph is painted. Shelf counts (10, 6, 1, 0) are numbers, not tiles. `TEMPLATE` and `NOT LIVE` are word badges.

## No icon

Route header **Explore** already uses `/public/brand/marks/explore.png`. Not regenerated.

Explore panel (`explore-panel.tsx`):

- Panel title **Explore** (`#explore-panel-title`) is text only.
- Shelf chips **All**, **Official**, **Assistant**, **Search**, **Programming**, **Image**, **Video**, **Audio**, **Budget**, **My agents**. Search already has `/public/brand/marks/search.png`. Not used here. Not regenerated.
- Source chips **Templates and saved**, **Templates**, **Saved agents**.
- Sort chips **Name**, **Role**.
- Saved filter **All** and **Saved**.
- Local persona rows have no leading image. Roles that already have unused marks: browser, research, documents (`docs.png`), email (`gmail.png`), data. Coding is not `build.png`. Content, knowledge, assistant, and manager have no files of their own.

Persona directory (`persona-directory.tsx`): category tabs are the same text chips. Cards use shared avatars (`avatar-documents`, `avatar-research`, `avatar-build`, `avatar-email`), not letter tiles. The hero uses `/brand/logo-mark.jpg`. **Back to Chat** is text.

## Saved (cap of two)

Generated with grok-imagine-image-2.0, quality low, aspect ratio 1:1, then resized to 128×128 PNG.

- `/public/brand/marks/official.png` — silver ring and diamond, for the Official shelf (pressed by default).
- `/public/brand/marks/assistant.png` — silver bust and spark, for the Assistant shelf and the Personal assistant row.

Video, Audio, Budget, Programming, Image, My agents, and the other iconless rows were left without files because of the cap of two.
