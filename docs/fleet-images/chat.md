# Chat surface marks

Preview: `http://127.0.0.1:8080/` on the command stage (header title “Chat”, `data-view="command"`). `command-app.tsx` was not edited, so these files are not wired in. Not committed. Not deployed.

## Letter tiles

None on this surface. The rail footer and the account menu already show images. No one- or two-letter glyph is painted in the Chat header, starters, or composer.

## No icon

- Header title **Chat** (`command-app.tsx` topbar `p`) is text only. No image.
- Voice mode chip **Direct** (`header-voice-mode`) is the word Direct. No glyph.
- Model chip **Auto** has a chevron, not a mark. Left without a file (cap of two).
- Status pill **Grok configured** is a CSS dot plus text. `/public/brand/marks/grok.png` already exists. Not regenerated.
- **⌘K** is a keyboard hint, not a mark.
- **Sign in** (`signed-out-entry__link`) and the sentence beside it are text only.
- Compact launcher **Speak** is the word Speak. `/public/brand/marks/speak.png` already exists. Not regenerated.
- Greeting, mode chips, Drive, and Imagine sit in the Chat source but CSS hides them on this open stage. They were not treated as visible missing marks.

Create an image, Write or edit, Search the web, Attach, and the round composer Speak button already use stroke icons. Alerts uses the bell; the “13” badge is a count, not a letter tile.

## Saved (cap of two)

Generated with grok-imagine-image-2.0, quality low, aspect ratio 1:1, then resized to 128×128 PNG.

- `/public/brand/marks/chat.png` — ice-blue speech bubble, for the Chat title.
- `/public/brand/marks/direct.png` — pale mint right arrow, for the Direct chip.
