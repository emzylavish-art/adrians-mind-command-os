# Testing and verification

Recorded after chat routing on top of `1becc98`.

| Check | Result |
|---|---|
| `npm test` | Pass. Script tests 202, TypeScript tests 161, failures 0. |
| `npx tsc --noEmit` | Pass. |
| `npx eslint` on the routing files | Pass. |
| `npm run build` | Pass. Then rebuilt after the last send-path edit. Migrate skipped. |
| Dev and production smoke | Exit 0. Consoles empty. No horizontal overflow. Ask, Research, Agent, and Build are on the command box. Build is in the sidebar. |
| Live Grok, search, Notion, Gmail, image, video | Not called. |

No screen recording file was attached. The check used the running app.
