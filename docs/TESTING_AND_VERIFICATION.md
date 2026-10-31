# Testing and verification

Recorded after the shell, palette, pins, and task-plan change on top of `49269f6`.

## Commands and results

| Check | Result |
|---|---|
| `npm test` | Pass. Script tests 202, TypeScript tests 156, failures 0. |
| `npx tsc --noEmit` | Pass. |
| `npx eslint` on the changed shell, fleet, palette, and provider files | Pass. |
| `npm run build` | Pass. Nitro `nodejs22.x`. |
| `npm run db:migrate` | Skip. Printed `[migrate] DATABASE_URL not set — skipping`. |
| `@tanstack/react-start` | 1.168.60. |
| Signed-out smoke, dev, desktop 1280×800 and mobile 390×844 | Exit 0. Title “Adrian's Mind”. Status 200. No horizontal overflow. Desktop and mobile consoles empty. Body starts with the grouped workspace navigation. |
| Signed-out smoke, production preview | Exit 0. Desktop and mobile consoles empty. No horizontal overflow. Same shell. |
| REA doctor | Not re-run. The earlier doctor exited 1: package 6.8.0, `healthy` false, Node 22.23.3, native engines missing. |
| Browser driver test | Included in the script tests. Local HTML only. |
| Hosted worker test | Included. Expects exit 2 and “Nothing ran”. |

The earlier caret-color hydration warning did not appear on this smoke.

## Not run, on purpose

- Live Grok send
- Live planner tool call
- Public page from the product Open page button
- Web search, image, or video
- Gmail OAuth
- Hosted worker against a real database
- Physical iPhone
- HP EliteBook
- Native REA engine installs

Spawned engineering agents were not used. The shell and worker files overlap.
