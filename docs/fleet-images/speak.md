# Speak surface marks

Preview: `http://127.0.0.1:8080/` with the Speak stage open (dialog title “Speak”). `command-app.tsx` was not edited, so this file is not wired in. Not committed. Not deployed.

## Letter tiles

None on this surface. `speak-stage.tsx` has no letter or two-letter glyph.

## No icon

- Stage header **Speak** (`speak-stage.tsx` header `p`) is text only. No image.
- Compact launcher **Speak** (`live-voice-bar.tsx` `live-voice-compact-entry__button`) is the word Speak with no glyph. It stays on screen while the stage is open.
- Voice style chips **Direct**, **Warm**, **Professional**, and **Playful** are text only.
- **Sign in to start the live call** is a text button.
- Status line (“Warm voice”) is status text, not a mark.
- Empty-state orb is a CSS sphere, not a letter tile and not an image.

Close, Camera, Screen share, Mute, and End call already use Lucide icons. The composer round Speak button uses a volume icon, not a letter. `/public/brand/marks/voice.png` is the Voice settings microphone and is not used here. Not regenerated.

Speak controls inside Settings → Voice (`speak-panel.tsx`) were not this open surface. They are text rows and chips (voice names, style, pace, prompt lines) plus the same Speak heading. No letter tiles there either.

## Saved (cap of two)

Generated with grok-imagine-image-2.0, quality low, aspect ratio 1:1, then resized to 128×128 PNG.

- `/public/brand/marks/speak.png` — ice-blue sound bars, for the Speak title and the text-only Speak launcher.

Style chips, the sign-in sentence, and the CSS orb were left without files. They are not a second app mark, so the second slot was not used.
