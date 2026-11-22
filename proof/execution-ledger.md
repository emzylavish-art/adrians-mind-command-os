# Execution ledger

Updated after the sidecar overlay. This file is not a claim that the installed Windows app was launched.

## Passed

- Two separate Node processes wrote and then reloaded `/home/ubuntu/adrians-mind-command-os/.data/local-capabilities.json`. Notes, consent, obligations, and grants reloaded. Result: pass. Released text was `restart note`.
- A later pair of processes reloaded skills, workflows, crisis mode, language, and text size from that same file. Result: pass.
- Source store, second process, after the approval write fix: approvals `adrian`, adapter `spatial-1 headset`. Result: pass.
- Packed sidecar bytes extracted from the exe, second process: skill `reading`, workflow `open the report`, crisis on, Yoruba, large, adapter `spatial-1 headset`, approval `adrian`. Result: pass.
- `src/lib/mind/local-capabilities.test.ts`: 3 passed.
- `src/lib/mind/voice/one-audio.test.ts`: 1 passed.

## Installer overlay

- The existing exe was updated in place. No NSIS rebuild.
- Packed `AdriansMind/resources/app.asar` is 29708 bytes.
- `session-local-store.mjs` inside the exe is now 5626 bytes. It was 2703 bytes.
- That packed store was not executed inside the Windows app.
- The exe was not published. Signing was not done. Vercel was not deployed.

## Still dies with the process

- Packed task envelopes. `pack task` returns text and does not write the envelope.
- Frontier information events and process-only delete marks. They are not in `.data/local-capabilities.json`.
- Speak audio tokens. The interrupt rule is a unit test, not a microphone session.
- Running agent tasks, model connections, and open voice sessions.

## Cannot verify here

HP EliteBook: screen understanding, accessibility tree, window management, installed-app launch, mouse finding, keyboard shortcuts, browser automation, and a worker after the app closes.

iPhone: microphone permission, live transcription, automatic end-of-turn, spoken playback, and interrupt on a real handset.

- Extracted sidecar is 16818 bytes. list capabilities, dry run rename, hash check, simulate, and switch window answered. Switch window refused because this machine is not Windows. The Windows app was not launched. Exe not published. Signing not done. Vercel not deployed.

- 15 tests passed, including Sources, extra PC refusals, and information-event reload. Extracted sidecar is 17494 bytes and answered find button, keep working after close, and right-click. The React toolbar change is source-only. app.asar was not rebuilt. Exe not published.
