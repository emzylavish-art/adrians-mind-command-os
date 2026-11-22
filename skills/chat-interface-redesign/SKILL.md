---
name: chat-interface-redesign
description: Raw material for a chat-interface-only redesign. Do not invent sections that were not pasted. Do not redesign the rest of Adrian.
---

# Chat interface redesign

Redesign and improve only the chat interface. Preserve existing working functionality. Do not replace Adrian's identity or rewrite unrelated sections. Inspect the current chat before changing it. Do not add a second layout system to hide an existing CSS problem.

## Objective

The conversation occupies the main workspace. AI replies use that width. The composer stays at the bottom. Previous conversations stay in the sidebar. A new conversation starts empty. The microphone types spoken words into the input. Live voice can listen and speak back. Playback and recording cancel separately. Send works. Desktop and mobile both behave.

ChatGPT screenshots are the visual reference. The current screenshots are the problem to study.

## Phase 1 — inspect first

Inspect the chat hierarchy, desktop and mobile layout, sidebar, message rendering, streaming, composer, send, microphone permission, transcription, speak, live voice, storage, loading, cancel, errors, and responsive CSS. Find why the composer sits where it does: split grid, constrained container, absolute position, flex, sticky or fixed, a desktop width cap, or a mobile breakpoint. Document that before editing.

## Phase 2 — layout

Three regions: sidebar, chat header, conversation workspace with a bottom composer.

Desktop: sidebar left, chat uses the rest of the width, header at the top, conversation fills the remaining height, composer at the bottom of that workspace. No second input on the right. The conversation is the main content.

The reply uses the available workspace width. It must hold long text, diagrams, images, code, and tables. It scrolls vertically. The composer never covers it and never squeezes it into a side column. A sensible reading width on a very wide screen is allowed. The composer spans the chat workspace with even gutters.

The composer stays at the bottom while the timeline scrolls. The timeline reserves the composer's height so the last lines stay readable. On mobile, use the safe-area inset. Do not assume the viewport height stays the same when the keyboard opens. Use the dynamic and visual viewport.

## Phase 3 — desktop

Keep the existing sidebar: navigation, new conversation, recent names, timestamps or previews. It is independent of the timeline.

Keep the header controls: thread selector, Controls, Chat settings, voice, and the other conversation controls. Keep the header compact.

Show user messages, assistant replies, streaming, loading, response actions, and sources in chronological order. Do not put the conversation in a small fixed-height box. Do not hide a reply behind the composer.

The composer expands with the chat. Send stays immediately reachable.

## Phase 4 — mobile

The header currently wraps onto too many rows. Make it compact: menu, current conversation, overflow, and voice access. Move secondary controls into an overflow menu. Do not remove functions.

The conversation uses nearly the full screen width with side padding. No split screen. No narrow inner column. Long replies scroll. The composer does not cover the last paragraphs.

The mobile composer is fixed to the bottom, spans the width, respects left, right, and bottom safe areas, stays usable when the keyboard opens, grows for longer text, and returns when the keyboard closes. It must not float in the middle.

## Phase 5 — new chat isolation

Yesterday's conversation must not appear inside a new chat. History stays in the sidebar. The workspace shows only the selected conversation.

New Chat creates a new id, clears the displayed list, resets streaming and loading, clears the draft, and shows an empty screen. Do not delete older chats. Do not copy the previous messages into the new one.

Each conversation has its own id. Switching loads that conversation only. Late streams from one thread must not land in another. Returning to an older chat shows its own history. The next new chat is empty again.

## Phase 6 — microphone

Pressing the microphone requests access if needed, starts capture, shows a recording indicator, and writes recognized words into the existing input as they arrive. The input must not stay empty behind a waveform. The user reviews the text before send.

Support interim and final text. Do not wipe typed text. Append dictated words to the draft. Handle punctuation when the result is final.

While recording, show the recording status, a visible audio activity indicator, Cancel, and Stop or finish.

Cancel stops capture and transcription, removes the uncommitted transcript, keeps text that existed before recording, releases audio, and returns the composer to normal. A normal stop finalizes the transcript into the composer and enables Send when there is text. Dictation is not sent automatically. The user reviews it and presses Send.

Handle permission granted, denied, unavailable, already in use, unsupported transcription, network loss, service failure, and user cancel. Never leave the microphone looking like it is still recording after an error. Show the reason and a working retry.

## Phase 7 — live voice

Live voice is separate from dictation. Adrian listens, shows the transcript, waits for a real end of turn rather than a short pause, processes one message, speaks the answer, then listens again without another Speak press. Do not send the same spoken turn twice. Do not answer the same transcript twice. Keep the written answer aligned with the spoken one when possible.

End or Cancel stops capture, voice processing, and playback, closes the session, releases audio, and returns to text chat.

The microphone must not keep listening after the session closes. Inspect the current voice code first. Reuse the working transport, transcription, and assistant path. Do not add a second audio provider. If full live voice is not actually supported, name the missing backend piece and wire it through the existing architecture. Do not fake it with a decorative microphone animation.

## Phase 8 — speak

Read aloud starts only when chosen, shows that it is playing, and the same control becomes Stop. Stop ends playback immediately. There is no hidden cancel.

In live voice, answers start speaking on their own, the screen says Adrian is speaking, interrupt stays available, and ending the session is separate.

These are different actions: cancel recording, stop playback, end the live session, and stop text generation. Stopping speech does not delete the written reply. Cancelling the microphone does not stop an unrelated text reply. Stopping generation does not close the conversation.

## Phase 9 — send

Send is disabled when the composer is empty. It becomes active and clickable when there is valid text, and it submits that text. While a message is being submitted, block a second send and show a sending state.

Send on click. Enter sends on desktop. Shift+Enter inserts a line. Mobile send works. Empty text cannot send. A double click does not duplicate the message. The composer clears at the right moment. The reply lands in the active conversation. Streaming starts. Errors are visible. A failed message can be retried without losing its text. Send is never stuck disabled, and it never looks active when the handler is broken.

## Phase 10 — streaming and scroll

Show the reply in the conversation as it arrives when the backend can stream. Support streaming text, loading, thinking, errors, stop generation, completion, long replies, markdown, code, images, diagrams, sources, and the existing response actions. Keep chronological order.

A new send keeps the newest message visible and follows the stream unless the user has scrolled up on purpose. Do not yank them back. Offer a return-to-latest control when needed. When a long answer finishes, the last paragraphs stay readable above the composer. The composer never covers the reply.

## Phase 11 — polish

Use the ChatGPT screenshots as the reference. Keep Adrian's branding. Improve hierarchy, dark surfaces, contrast, alignment, spacing, button identity, hover and active states, responsive size, and restrained motion. Do not add complexity. Every button has a purpose and works. Do not remove a useful control just to simplify the look.

## Phase 12 — protect what works

Do not trade a working feature for the new layout. Before editing, name dependencies, API contracts, persistence, streaming, audio, shared components, and likely regressions. Change in stages. Do not rewrite the app. Do not replace backend logic with mocks, fake transcripts, or a fake Send. Do not claim live voice works unless the audio interaction actually works. Make the smallest change that solves the problem. Keep a record of changed files.

## Phase 13 — order

Implement in this order.

1. Layout. The composer stays at the bottom and the conversation uses the full workspace on desktop and mobile. No split input.
2. Isolation. A new thread is empty. Older chats stay in the sidebar. Messages do not leak across threads.
3. Send. Empty stays disabled. Enter sends. Shift+Enter adds a line. A double click does not duplicate. A failed send can be retried with its text.
4. Dictation. Words appear in the composer. Cancel drops only the uncommitted transcript. A normal stop leaves text for the user to send.
5. Speak. Read aloud can be stopped immediately. The written reply stays.
6. Live voice. One spoken turn gets one spoken answer, then listening resumes. End releases the microphone. Do not claim this works unless the audio path actually does.
7. Visual polish. Compact the mobile header without removing controls. Fix spacing, type, safe areas, and long replies so desktop and mobile are both usable.

## Phase 14 — regression

After the redesign, check desktop and mobile, a new chat, an old chat, switching threads, short, long, and multiline sends, a long reply, scrolling, stop generation, copy, read aloud, stop playback, dictation appearing in the field, cancel recording, finish recording, send dictated text, denied microphone, transcription failure, live voice, an automatic spoken answer, interrupt, end live voice, keyboard open and close, rotation, reload, and persistence.

Fail the pass if there is a console error, a failed request, a missing handler, a bad state change, a leaked microphone, a duplicate message, a message in the wrong thread, a broken layout, a scroll jump, a composer covering text, or audio that continues after cancel.

## Phase 15 — done means proven

Layout is done when the sidebar stays, the conversation uses the main workspace, there is no split input, the composer is full width at the bottom, and it never covers a reply on desktop or mobile.

Conversations are done when New Chat is empty, old chats stay in the sidebar, messages do not leak, switching restores the right history, and a stream stays on its own thread.

Send is done when typing, multiline, activation, submit, and duplicate blocking work, and errors can be retried.

The microphone is done when permission is handled, words appear in the input, the transcript can be edited, Cancel and Stop work, and the mic is released.

Speak is done when Read aloud can be stopped and the written reply remains. Live voice is done only if it actually listens, shows the transcript, speaks the answer, can be interrupted, and releases the mic. Text chat must still work after that.

Do not present a mock, a fake transcript, or a decorative mic as finished. After each stage, test the real interaction. If a backend piece is missing, name it and finish only what will not break the rest.

Before calling this finished, report the change summary, files, layout result, dictation result, speak and live-voice result, isolation result, desktop and mobile result, and any remaining blocker. An untested feature is not working.


## Visual hierarchy addendum

This adds to the layout spec. It does not replace it. Only the chat experience changes. Do not invent past the paste.

The chat must not look like a stack of grey paper cards. Do not wrap every user line, every assistant reply, or every action row in a large bordered panel. Use the app background as the canvas. Separate people by type, spacing, and a light surface only where it helps.

The response toolbar is not a line of plain text. Group it.

Content actions: Copy, and Share if it already exists.
Audio actions: Read aloud, which becomes Stop while audio plays. Do not show Play and Stop together.
Generation actions: Regenerate, and Stop generating while a reply is in flight. Regenerate has its own icon and label. It is not Read aloud.
Information actions: Sources when they exist, Feedback, and More. More opens a real menu for the secondary actions. Feedback stays quiet but reachable.

The toolbar is one control system, not a sentence of links and not a row of raised cards. Primary actions are Copy, Read aloud, and Regenerate. Secondary actions are Sources, Feedback, and More. On desktop they stay in one compact bar with even icons, spacing, and a light separator between groups. On mobile, important actions stay tappable and secondary actions move into More before labels overflow.

The toolbar belongs to the reply. It must not compete with the answer.

Surfaces stay quiet. Contrast is controlled. Floating controls may be slightly translucent, with blur only where the browser supports it, a light shadow, one corner radius, and a fine border only when it is needed. Do not blur the conversation. Do not shadow every message. Do not turn messages into floating sheets. Translucency is for the composer, menus, temporary controls, and compact overlays.

Conversation content stays on the workspace, not inside sheets.

Motion is short and deliberate. Animate state changes only: sidebar, switching chats, new chat, composer growth, response actions, More, play and stop, recording, Live Voice, and generation. Use a short fade or a small move. No bounce. No looping motion. Honor reduced motion.

A streaming reply is ordinary text in the workspace, not a document inside a grey sheet. Headings, paragraphs, lists, code, tables, and sources keep their own spacing. Actions stay out of the stream. While a reply is generating, show the generation control, not the finished-action row.

After a reply finishes, show the full toolbar.

The composer is a floating control surface, not another large card. It keeps a rounded input, a light translucent fill, even internal spacing, clear attach, microphone, and Send controls, and it grows smoothly for extra lines. Active and disabled states stay obvious. It stays full width of the chat workspace, bottom-fixed, and it never covers the reply. Keyboard-aware behaviour from the earlier spec stays.

The chat uses one scale: type, spacing, icon size, corner radius, surface, border, motion timing, states, and touch targets. The toolbar, composer, menus, header, and voice controls share that scale. Do not style each piece on its own.

After the change, look at the rendered app, not only the code. The conversation must read as one product, not stacked cards. The reply is the dominant thing. Copy, Read aloud, and Regenerate are one group. Sources, Feedback, and More are the quieter group. Controls are identifiable. The composer looks finished. Phone and desktop stay full workspace. Motion is intentional. Nothing is boxed, raised, or cluttered without a reason.

The finished chat is a continuous canvas, a full-width bottom composer, a clear reply hierarchy, and one categorized toolbar: content, audio, generation, and information. Surfaces stay restrained. Motion is short. Phone and desktop stay responsive. No paper cards. Quality comes from hierarchy, spacing, material, and consistency, not from more borders, shadows, or rounded boxes. Existing working behaviour stays.

Visual hierarchy paste is complete through the final design standard.


## Live voice, Speak, and brand paste

Upgrade only. Do not rebuild Adrian. Do not replace auth, permissions, integrations, or data. Do not add a second system without an approved reason. Vercel stays the web app and short APIs. Persistent voice sessions stay on the persistent worker. LiveKit Agents JS stays the voice agent for EVE.

Before any change, inspect Speak, Intelligence and Emma's video, session start, microphone capture, speech-to-text, transcript streaming, turn detection, the reply, text-to-speech, playback, interruption, voice settings, screen share, every button handler, LiveKit, the worker, reconnect, mobile Safari, and the logo assets.

Find why two voices talk at once. Trace audio from the microphone to the speaker. Check whether more than one speech engine, stream, subscription, or the browser's own speech synthesis is running at the same time.

The audit must list what works, what is broken, what is duplicated, what is missing, the cause, the dependency, the risk, the fix, and how to prove it. A visible button is not proof.

Live conversation is one session, not Speak, wait, Speak again. One microphone start opens the session. Capture stays on. Words appear in the input as they are recognized. Turn detection decides when the user has finished. That utterance is sent without another Speak press and without Send. The reply is spoken automatically. The session stays open for the next turn until the user ends it.

Show partial words, the final line, and whether Adrian is listening, processing, or speaking. Show recognition errors. Never send a partial line. Only a finished turn is submitted.

Cancel sits in or beside the input. It stops capture, drops the unfinished line, blocks a send, and returns to idle or listening. End Live Conversation is a separate, obvious control.

If the user speaks while Adrian is talking, playback stops at once, listening resumes, the new words are captured, and history stays. No manual stop is required for that interrupt.

One session has one assistant audio path. One provider, one stream. Browser speech and provider audio never play together. A new clip cancels the old one. Subscriptions and resources are released when the session ends. Reconnect, late events, a dropped line, and playback errors must not start a second voice. A replaced answer must not keep speaking. Do not fix this by turning one voice down. Remove the second output.

One microphone control. It starts listening, shows the recording state, shows permission errors, cancels, ends the session, and never opens a second capture. Do not add another microphone button for the same job.

Output controls volume and mute only. They never become a second microphone.

Screen share starts, shows its state, and stops. A denied or unsupported share gets a clear explanation. Do not show a permanent cancelled message when nobody has tried to share.

Settings that must work: voice, output volume, microphone choice where the browser allows it, recognition, turn detection where it exists, language, permissions, and troubleshooting. Save the choices.

The waveform follows real state: listening, the user speaking, processing, Adrian speaking, muted, or disconnected. No decoration that moves when nothing is happening.

Code opens its real coding place, or it leaves the voice screen. A dead button is not allowed.

The plus button opens a working attachment picker and keeps the attachment types and permissions that already work.

End Conversation stops the session, stops audio, releases the microphone, and cleans up.

Dictation and live conversation share one microphone control. Dictation writes into the field, can be edited or cancelled, and waits for Send. Live conversation is the main mode: one start, words in the field, a finished turn sends itself, the reply is spoken, and the next turn can start until End Conversation. The choice lives in voice settings.

The voice screen is a finished product, inspired by native restraint, not a copy of Apple. Order is status, live transcript, reply, activity, controls, then the bottom composer. No extra empty space, no grey panels, no generic mark where a real identity exists. Listening and speaking must be obvious. Phone Safari must keep the input above the keyboard and the browser chrome.

Logo audit covers the whole platform. Inventory navigation, modules, integrations, apps, models, tools, services, projects, and brand references. Identify each external product and use its official logo. Official brand pages come first.

Logo sources, in order: official brand pages, the company site, developer docs, a verified repository, then another trustworthy source only if no official file exists. Prefer SVG. No unrelated icons, no random search images, no screenshots unless no official file exists and use is allowed. Confirm the mark belongs to that brand.

One registry: name, source, path, format, light and dark variants, restrictions, and whether it was verified. Adrian's own features get one original icon set. Every page uses the registered mark. Do not invent a brand. If a mark cannot be verified, leave it unresolved and say so.

A voice session must not stick. Handle a denied or missing microphone, a dropped network, an agent timeout, recognition failure, speech failure, playback failure, LiveKit reconnect, a second session start, a background tab, Safari interruptions, cancel, and expiry. Clean up. No orphan session. Only the current session owns the microphone and the speaker. An old session must not speak after a new one has started.

Session operations must be observable and testable. Long-running voice state does not live in a short Vercel function. It stays on the persistent worker.

Do not call this done until the tests pass. One start covers several sentences, live words, automatic end of turn, automatic send, automatic speech, and the next turn without a restart. Interrupt stops playback at once and the conversation continues. Cancel drops an unfinished line. End releases the microphone and the speaker.

One voice only. Interrupt, reconnect, and switching chats must not let old audio overlap new audio.

Every button does its real job and shows feedback. A click handler is not enough.

Logos match the official mark on light and dark, phone and desktop, with no broken path and no missing mark where one was verified.

Test the deployed app on iPhone Safari, a desktop browser, and a phone-sized viewport. Real microphone permission and real playback on the physical iPhone are required. A desktop simulation is not enough.

Before calling it finished, report the audit, the two-voice cause, the architecture change, the microphone and transcript change, how live conversation works, which controls actually work, the logo inventory, unresolved marks, the tests, the results, what is still blocked, whether it is deployed, and how to roll it back. Completed work and unproven work stay in separate lists.

An implemented feature that was not tested is not working. Live conversation is not working until it is tested on the actual iPhone.

The finished bar: open Adrian, start the microphone once, speak, see the words, get an automatic send and one spoken reply, then continue. Interrupt, cancel, and end must work. Every voice control must do its job. Every shown logo must be the right product. The screen must feel finished. Existing working features stay. No rebuild, no second system, no fake success.

Live voice, Speak, and brand paste is complete through the final acceptance standard.
