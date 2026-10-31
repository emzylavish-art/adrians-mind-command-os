# External blockers

| Blocker | What you do | Spend? |
|---|---|---|
| Node 22.23.3 is below REA's 22.23.4 floor | Install a newer Node on the machine that should run REA. This sandbox was not upgraded. | No |
| `ps` missing, native REA engines missing, MCP registration missing | Install procps and only the engines you authorize. Run `npx rea-agents@latest setup` and restart the client. Doctor must be re-run. Do not treat setup success as health. | Local software. Hopper or IDA may cost money. Do not buy them without approval. |
| No Chrome on 127.0.0.1:9222 | Start a dedicated browser and sign in yourself. Do not paste passwords into the repo. | No |
| `DATABASE_URL` unset | Create a new Supabase project in a new organization for this app only. Do not use Oak Bridge, BridgePoint, `ybxowvzicirinpdcfyqe`, or `espmxiitzucooxblmnpr`. | Possible |
| No Google OAuth client | Create a Google Cloud OAuth client and store tokens only on the server. | Possible |
| No search endpoint or key | Set `MIND_SEARCH_ENDPOINT` and `MIND_SEARCH_KEY`. | Yes, when used |
| No hosted worker host | Provision a process that can see the dedicated database, then replace the exit-2 script with a real poller. | Possible |
| No iPhone in the loop | On the published HTTPS site in Safari: Share, Add to Home Screen, Add. | No |
| HP EliteBook not paired | Pair on that machine. It is not connected. | No |
| Live Grok not re-checked | Press Send while signed in, or run `MIND_LIVE_GROK=1 node scripts/verify-grok.mjs`. | Yes, small |
