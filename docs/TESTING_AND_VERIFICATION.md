# Testing and verification

Recorded after the local-worker and shell change on top of `3d38813`. No source file was edited after these commands.

## Commands and results

| Check | Result |
|---|---|
| `npm test` | Pass. Script tests 202, TypeScript tests 150, failures 0. |
| `npx tsc --noEmit` | Pass. |
| `npx eslint` on the changed mind, fleet, browser, and worker files | Pass. |
| `npm run build` | Pass earlier in this change. Source files are older than `.vercel/output`. |
| `npm run db:migrate` | Skip. Printed `[migrate] DATABASE_URL not set — skipping`. |
| `@tanstack/react-start` | 1.168.60. |
| Signed-out smoke, dev, desktop 1280×800 and mobile 390×844 | Exit 2. Page title “Adrian's Mind”. Status 200. No horizontal overflow. Body starts “Command Chat Agents Runs Projects”. Mobile console was empty. Desktop console reported one hydration mismatch: the preview host added `caret-color: transparent` on the search field, the command box, and the hidden file input. That style is not in the app source. `pageErrors` was empty. A second run in this session failed the same way, so it is recorded as a preview-host warning, not a passing console. |
| Signed-out smoke, production preview | Exit 0. Desktop and mobile consoles were empty. No horizontal overflow. The same navigation labels rendered. Compared with the dev capture, mobile body text length differed (1085 vs 1196). The screens showed the same shell, not a blank page. |
| REA doctor | Not re-run in this verification pass. The earlier doctor in this change exited 1: package 6.8.0, `healthy` false, Node 22.23.3, native engines missing. |
| `scripts/mind-browser.test.mjs` | Included in the 202 script tests. It opens a local HTML document only. |
| `scripts/mind-worker.test.mjs` | Included in the 202. Expects exit 2 and “Nothing ran”. |

## Not run, on purpose

These would spend money, need a device, or need a credential that is not configured:

- Live Grok send (`MIND_LIVE_GROK` was not set)
- Live planner tool call
- Public page opened from the product Open page button
- Web search
- Image or video generation
- Gmail OAuth
- Hosted worker against a real database
- Physical iPhone
- HP EliteBook
- `npx rea-agents setup` and native engine installs

Spawned engineering agents were not used. The same files (workspace types, shell, server) overlap, so the work stayed in one pass.
