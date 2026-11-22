---
name: chat-stage-fix
description: Auto-load on any Adrian OS chat, phone, desktop, mic, translator, image, or composer layout fix. Do not ask permission to load this skill.
---

# Chat stage fix

Load this without asking when the task touches chat UI, the composer, mic, Speak, translator, image replies, light-theme text, or the greeting.

## Stage

- Keep the top Thread and Controls bar.
- Chat settings open from that top bar, in one sheet. Closed, they do not cover the reply.
- On the first message, remove Good morning and in-thread Recent. Recent stays in the sidebar. New Chat brings the greeting back.
- The middle is only this conversation.
- After a reply, suggestion chips and Read aloud sit above the input.
- The lowest row is the field, Mic, Speak, and Send. They are never in the middle.
- Mic types into the field. Speak is the only voice. Translator is one cancellable control, English first, every ISO 639-1 language. Do not claim Opus-MT translated unless weights are loaded.
- An image request must show the picture in the thread before image generation is called finished.
- White backgrounds use thick black text. Do not deploy or update the installer in the same step as an unproven layout change.

## Proof

Phone 390x844 and desktop 1280x800. Save shots under `proof/chat-stage/`. Do not call production updated from this skill.
