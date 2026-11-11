# Connection gaps before production

Checked on 2026-11-11 against `feature/adrian-build-kimi-hosted`. This is not a deploy. No secret values are recorded here.

## Finished on this branch

| Connection | Evidence | Still not live |
| --- | --- | --- |
| Grok model key | Stored for this session. `GET /v1/models` returned 200 and 13 models. A one-word Fast completion returned `ready`. Fast, Expert, Heavy, and `grok-build-0.1` were in the model list. | The live site is still the older deployment. This key is not in the Vercel project. |
| Grok management key | Stored separately. `GET /auth/management-keys/validation` returned 200. It is not used for chat or voice. | It is not the pairing HMAC key and it does not connect Notion, Gmail, or GitHub. |
| Voice | The same model key minted a realtime client secret, HTTP 200. The branch uses that key only when `XAI_VOICE_API_KEY` is absent and the key is not the management key. Tests: `keys.test.ts`, `client-secret.test.ts`, 8 passed. | A browser Speak session was not run on the live site. |
| Adrian Build plan | Build can ask Grok for a plan through the existing turn route. The reply is labeled as a plan. It does not edit a file. | A signed-in browser click of that button was not run in this pass. |

## Cannot be finished from here

| Connection | Why it stays open |
| --- | --- |
| Notion | `NOTION_TOKEN`, `NOTION_API_KEY`, and `NOTION_OAUTH_CLIENT_ID` are empty. No page was searched or updated. |
| Gmail, Drive, Docs, Calendar, Slack | No Google or Slack OAuth client is configured. Nothing was read or sent. |
| GitHub | No GitHub token or OAuth client is configured. Nothing was pushed. |
| Web search | `MIND_SEARCH_ENDPOINT` and `MIND_SEARCH_KEY` are empty. No citations were created. |
| Claude, Gemini, OpenRouter | Those keys are empty. They cannot be selected. |
| OpenAI / Astra / Sol / Luna | A sandbox OpenAI variable exists. It was not copied into Adrian OS and it is not a live product connection. |
| Dedicated database | `DATABASE_URL`, `POSTGRES_URL`, and `SUPABASE_URL` are empty. Migration `0008` is not applied to production. |
| Local computer | No Windows Companion is paired. File edits, terminal output, and Git writes cannot run. |
| Kimi Code | The installed CLI can authenticate and open a session. A coding prompt was refused because this subscription does not include Kimi Code. No file was written. |
| MCP inside Kimi | The hosted session still sends `mcpServers: []`. Only an approved, enabled, allowlisted stdio server can be mapped. None is approved. |
| Plugins, skills, hooks, subagents | No verified plugin or skill surface is connected to the runtime that answered. |
| Production deploy | No Vercel token. Deploy waits for an explicit production go-ahead. |
