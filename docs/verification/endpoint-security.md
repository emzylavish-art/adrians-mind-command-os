# Endpoint authorization inventory (C1-AA060)

This checked-in inventory covers every direct route handler and exported TanStack server function discovered from TypeScript AST. A new route, HTTP method, RPC export, removed guard marker or undocumented public exception fails the normal test runner. Guard-source checks establish code reachability contracts; they do not substitute for live penetration testing or prove that a browser/provider/device was exercised.

86 routes · 125 HTTP method contracts · 65 RPC exports.

## Shared policies

| Policy | Contract |
|---|---|
| owner_read | Verified owner; return only owner-scoped records. Reads do not grant dispatch authority. |
| owner_origin | Verified owner plus browser origin protection before mutation; recheck destination/approval and halt at dispatch. |
| owner_fetch_metadata | Verified owner plus Fetch-Metadata isolation; explicit bearer callers remain authenticated. |
| owner_rpc | authMiddleware verifies owner and request isolation; context.userId scopes stored data. |
| optional_owner_rpc | Explicit public/status result when signed out; owner data requires independently verified session and isolation. |
| oauth_callback | Owner-bound, expiring, single-use state and callback checks; provider redirect is intentionally not same-origin. |
| framework_auth | Authentication framework owns session establishment, trusted-origin and callback checks. |
| credential_establishment | Origin-protected pre-login action; supplied credentials/provider flow establishes identity, no preexisting owner required. |
| session_probe | Verify current session or return signed-out state; no mutation or provider dispatch. |
| schedule_worker | A separately provisioned worker bearer authorizes a bounded scheduler pass with owner-scoped claims and emergency-stop checks. |
| notification_worker | A dedicated worker bearer authorizes bounded delivery for current account opt-ins. Each outbound attempt requires a durable claim. |
| paired_device | Verify device token/code, revocation and job ownership. Cookie presence alone never authorizes device execution. |
| mixed_owner_device | Dispatch-specific owner or device credentials; browser owner mutations require origin guard; device actions keep job binding. |
| public_status | Explicit sanitized readiness/manifest result; never return credentials, private account records or execute an action. |
| public_verification | Verify supplied public manifest/signature only; cannot mutate an account or execute device commands. |
| local_only | Origin protection and exact loopback/non-hosted restriction; reject unavailable request context. |

## Direct routes

| Route | Methods | Policy | Guard source / ownership boundary |
|---|---|---|---|
| `/api/auth/$` | GET, POST | framework_auth | Better Auth and explicit trusted origins own login and callbacks. Passkey routes check the configured origin and protect account credential changes with a fresh verified session. Authenticator changes use the canonical account and login challenges are verified by Better Auth. Account email is origin-bound, and address verification is scoped to the signed-in credential account. Sources: `src/routes/api/auth/$.ts`, `src/lib/auth/server.ts` |
| `/api/mind/agent` | POST | owner_fetch_metadata | Verified session/bearer owner scopes records and dispatch; origin guard precedes browser mutation. Sources: `src/lib/mind/agent-run.server.ts` |
| `/api/mind/build/browser` | DELETE, GET, POST | owner_origin | Verified session/bearer owner scopes records and dispatch; origin guard precedes browser mutation. Build and legacy Kimi aliases share the named runtime-specific handler; target selection is explicit. Sources: `src/lib/mind/kimi/hosted/browser-route.server.ts` |
| `/api/mind/build/cancel` | POST | owner_origin | Verified session/bearer owner scopes records and dispatch; origin guard precedes browser mutation. Build and legacy Kimi aliases share the named runtime-specific handler; target selection is explicit. Sources: `src/routes/api/mind/build/cancel.ts` |
| `/api/mind/build/capabilities` | GET | owner_read | Verified session/bearer owner scopes records and dispatch; origin guard precedes browser mutation. Build and legacy Kimi aliases share the named runtime-specific handler; target selection is explicit. Sources: `src/lib/mind/kimi/phase4.server.ts` |
| `/api/mind/build/files` | GET, POST | owner_origin | Verified session/bearer owner scopes records and dispatch; origin guard precedes browser mutation. Build and legacy Kimi aliases share the named runtime-specific handler; target selection is explicit. Sources: `src/lib/mind/kimi/files.server.ts` |
| `/api/mind/build/ide` | GET, POST | owner_origin | Verified session/bearer owner scopes records and dispatch; origin guard precedes browser mutation. Build and legacy Kimi aliases share the named runtime-specific handler; target selection is explicit. Sources: `src/lib/mind/kimi/ide.server.ts` |
| `/api/mind/build/projects` | GET, POST | owner_origin | Verified session/bearer owner scopes records and dispatch; origin guard precedes browser mutation. Build and legacy Kimi aliases share the named runtime-specific handler; target selection is explicit. Sources: `src/lib/mind/kimi/phase4.server.ts` |
| `/api/mind/build/providers` | GET, POST | owner_origin | Verified session/bearer owner scopes records and dispatch; origin guard precedes browser mutation. Build and legacy Kimi aliases share the named runtime-specific handler; target selection is explicit. Sources: `src/routes/api/mind/build/providers.ts`, `src/lib/mind/kimi/phase4.server.ts` |
| `/api/mind/build/runtime` | GET, POST | owner_origin | Verified session/bearer owner scopes records and dispatch; origin guard precedes browser mutation. Build and legacy Kimi aliases share the named runtime-specific handler; target selection is explicit. Sources: `src/lib/mind/kimi/hosted/runtime.server.ts` |
| `/api/mind/build/session` | GET, POST | owner_origin | Verified session/bearer owner scopes records and dispatch; origin guard precedes browser mutation. Build and legacy Kimi aliases share the named runtime-specific handler; target selection is explicit. Sources: `src/lib/mind/kimi/acp.server.ts` |
| `/api/mind/build/terminal` | POST | owner_origin | Verified session/bearer owner scopes records and dispatch; origin guard precedes browser mutation. Build and legacy Kimi aliases share the named runtime-specific handler; target selection is explicit. Sources: `src/routes/api/mind/build/terminal.ts` |
| `/api/mind/build/voice` | POST | owner_origin | Verified session/bearer owner scopes records and dispatch; origin guard precedes browser mutation. Build and legacy Kimi aliases share the named runtime-specific handler; target selection is explicit. Sources: `src/lib/mind/kimi/phase4.server.ts` |
| `/api/mind/dashboard/health` | GET | owner_read | Reads owner-scoped Dashboard and worker health; rate-limited before returning diagnostics. Sources: `src/routes/api/mind/dashboard/health.ts` |
| `/api/mind/dashboard/status` | GET | public_status | Explicit public sanitized dashboard readiness; no private connected-account records. Sources: `src/routes/api/mind/dashboard/status.ts` |
| `/api/mind/desktop-update` | GET | public_status | Public installer update manifest only; no install or account mutation. Sources: `src/routes/api/mind/desktop-update.ts` |
| `/api/mind/dispatch-policy` | GET, POST | owner_origin | Authenticated owner reads settings and approves changes. Browser mutations require the current origin. Financial policy actions scope the request to that owner. Sources: `src/routes/api/mind/dispatch-policy.ts` |
| `/api/mind/fleet/execute` | POST | owner_origin | Rechecks the current account, emergency control and saved run for external steps. Sources: `src/routes/api/mind/fleet/execute.ts` |
| `/api/mind/fleet/history` | POST | owner_origin | Clears selected terminal records from the verified owner’s workspace. Sources: `src/routes/api/mind/fleet/history.ts` |
| `/api/mind/kimi/browser` | DELETE, GET, POST | owner_origin | Verified session/bearer owner scopes records and dispatch; origin guard precedes browser mutation. Build and legacy Kimi aliases share the named runtime-specific handler; target selection is explicit. Sources: `src/lib/mind/kimi/hosted/browser-route.server.ts` |
| `/api/mind/kimi/cancel` | POST | owner_origin | Verified session/bearer owner scopes records and dispatch; origin guard precedes browser mutation. Build and legacy Kimi aliases share the named runtime-specific handler; target selection is explicit. Sources: `src/routes/api/mind/kimi/cancel.ts` |
| `/api/mind/kimi/capabilities` | GET | owner_read | Verified session/bearer owner scopes records and dispatch; origin guard precedes browser mutation. Build and legacy Kimi aliases share the named runtime-specific handler; target selection is explicit. Sources: `src/lib/mind/kimi/phase4.server.ts` |
| `/api/mind/kimi/files` | GET, POST | owner_origin | Verified session/bearer owner scopes records and dispatch; origin guard precedes browser mutation. Build and legacy Kimi aliases share the named runtime-specific handler; target selection is explicit. Sources: `src/lib/mind/kimi/files.server.ts` |
| `/api/mind/kimi/ide` | POST | owner_origin | Verified session/bearer owner scopes records and dispatch; origin guard precedes browser mutation. Build and legacy Kimi aliases share the named runtime-specific handler; target selection is explicit. Sources: `src/lib/mind/kimi/ide.server.ts` |
| `/api/mind/kimi/projects` | GET, POST | owner_origin | Verified session/bearer owner scopes records and dispatch; origin guard precedes browser mutation. Build and legacy Kimi aliases share the named runtime-specific handler; target selection is explicit. Sources: `src/lib/mind/kimi/phase4.server.ts` |
| `/api/mind/kimi/providers` | GET, POST | owner_origin | Verified session/bearer owner scopes records and dispatch; origin guard precedes browser mutation. Build and legacy Kimi aliases share the named runtime-specific handler; target selection is explicit. Sources: `src/routes/api/mind/kimi/providers.ts`, `src/lib/mind/kimi/phase4.server.ts` |
| `/api/mind/kimi/runtime` | GET, POST | owner_origin | Verified session/bearer owner scopes records and dispatch; origin guard precedes browser mutation. Build and legacy Kimi aliases share the named runtime-specific handler; target selection is explicit. Sources: `src/lib/mind/kimi/hosted/runtime.server.ts` |
| `/api/mind/kimi/session` | GET, POST | owner_origin | Verified session/bearer owner scopes records and dispatch; origin guard precedes browser mutation. Build and legacy Kimi aliases share the named runtime-specific handler; target selection is explicit. Sources: `src/lib/mind/kimi/acp.server.ts` |
| `/api/mind/kimi/terminal` | POST | owner_origin | Verified session/bearer owner scopes records and dispatch; origin guard precedes browser mutation. Build and legacy Kimi aliases share the named runtime-specific handler; target selection is explicit. Sources: `src/routes/api/mind/kimi/terminal.ts` |
| `/api/mind/kimi/voice` | POST | owner_origin | Verified session/bearer owner scopes records and dispatch; origin guard precedes browser mutation. Build and legacy Kimi aliases share the named runtime-specific handler; target selection is explicit. Sources: `src/lib/mind/kimi/phase4.server.ts` |
| `/api/mind/managed-browser` | POST | owner_origin | Verified same-origin browser operations scoped to the signed-in owner, a saved session revision and an operator-approved destination. Sources: `src/routes/api/mind/managed-browser.ts`, `src/lib/mind/managed-browser.server.ts` |
| `/api/mind/mcp/builtin` | DELETE, GET, POST | owner_origin | Verified session/bearer owner scopes records and dispatch; origin guard precedes browser mutation. Sources: `src/routes/api/mind/mcp/builtin.ts` |
| `/api/mind/mcp/call` | POST | owner_origin | Verified session/bearer owner scopes records and dispatch; origin guard precedes browser mutation. Sources: `src/routes/api/mind/mcp/call.ts` |
| `/api/mind/mcp/servers` | GET, POST | owner_origin | Verified session/bearer owner scopes records and dispatch; origin guard precedes browser mutation. Sources: `src/routes/api/mind/mcp/servers.ts` |
| `/api/mind/mcp/tools` | GET | owner_read | Verified session/bearer owner scopes records and dispatch; origin guard precedes browser mutation. Sources: `src/routes/api/mind/mcp/tools.ts` |
| `/api/mind/media/cloud/fetch` | POST | owner_fetch_metadata | Verified session/bearer owner scopes records and dispatch; origin guard precedes browser mutation. Sources: `src/lib/mind/media/cloud/http.ts` |
| `/api/mind/media/cloud/list` | GET | owner_fetch_metadata | Verified session/bearer owner scopes records and dispatch; origin guard precedes browser mutation. Sources: `src/lib/mind/media/cloud/http.ts` |
| `/api/mind/media/cloud/status` | GET | owner_fetch_metadata | Verified session/bearer owner scopes records and dispatch; origin guard precedes browser mutation. Sources: `src/lib/mind/media/cloud/http.ts` |
| `/api/mind/media/generate` | GET, POST | owner_fetch_metadata | Verified session/bearer owner scopes records and dispatch; origin guard precedes browser mutation. Sources: `src/lib/mind/media/imagine-http.ts` |
| `/api/mind/media/storage/status` | GET | owner_fetch_metadata | Verified session/bearer owner scopes records and dispatch; origin guard precedes browser mutation. Sources: `src/lib/mind/media/storage/http.ts` |
| `/api/mind/media/storage/upload` | POST | owner_fetch_metadata | Verified session/bearer owner scopes records and dispatch; origin guard precedes browser mutation. Sources: `src/lib/mind/media/storage/http.ts` |
| `/api/mind/memory-policy` | GET, POST | owner_origin | Reads and updates the verified owner’s dispatch-time memory permissions. Sources: `src/routes/api/mind/memory-policy.ts` |
| `/api/mind/notifications` | GET, POST | owner_origin | The current owner manages consent and inbox marks, and may confirm only their own current push receipt. Email is derived from the verified account. Sources: `src/routes/api/mind/notifications.ts`, `src/lib/mind/notification-delivery.server.ts` |
| `/api/mind/notifications/tick` | POST | notification_worker | A dedicated token authorizes delivery only after account consent, current destination, halt state and event deduplication are checked. Sources: `src/routes/api/mind/notifications/tick.ts`, `src/lib/mind/notification-delivery.server.ts` |
| `/api/mind/nuance/key` | POST | owner_origin | Verified session/bearer owner scopes records and dispatch; origin guard precedes browser mutation. Sources: `src/routes/api/mind/nuance/key.ts` |
| `/api/mind/nuance/session` | GET, POST | owner_origin | Verified session/bearer owner scopes records and dispatch; origin guard precedes browser mutation. Sources: `src/routes/api/mind/nuance/session.ts` |
| `/api/mind/oauth/$connector/callback` | GET | oauth_callback | Provider redirect requires code/state and current expected owner; durable exchange consumes owner-bound expiring state. Sources: `src/routes/api/mind/oauth/$connector/callback.ts`, `src/lib/mind/connectors/durable-oauth.server.ts` |
| `/api/mind/oauth/$connector/disconnect` | POST | owner_origin | Verified session/bearer owner scopes records and dispatch; origin guard precedes browser mutation. Sources: `src/routes/api/mind/oauth/$connector/disconnect.ts` |
| `/api/mind/oauth/$connector/start` | GET | owner_origin | Verified session/bearer owner scopes records and dispatch; origin guard precedes browser mutation. GET creates pending OAuth state and therefore also checks origin. Sources: `src/routes/api/mind/oauth/$connector/start.ts` |
| `/api/mind/oauth/$connector/status` | GET | owner_read | Verified session/bearer owner scopes records and dispatch; origin guard precedes browser mutation. Sources: `src/routes/api/mind/oauth/$connector/status.ts` |
| `/api/mind/oauth/notion/callback` | GET | oauth_callback | Provider redirect requires code/state and current expected owner; durable exchange consumes owner-bound expiring state. Sources: `src/routes/api/mind/oauth/notion/callback.ts`, `src/lib/mind/connectors/durable-oauth.server.ts` |
| `/api/mind/oauth/notion/disconnect` | POST | owner_origin | Verified session/bearer owner scopes records and dispatch; origin guard precedes browser mutation. Sources: `src/routes/api/mind/oauth/notion/disconnect.ts` |
| `/api/mind/oauth/notion/start` | GET | owner_origin | Verified session/bearer owner scopes records and dispatch; origin guard precedes browser mutation. GET creates pending OAuth state and therefore also checks origin. Sources: `src/routes/api/mind/oauth/notion/start.ts` |
| `/api/mind/oauth/notion/status` | GET | owner_read | Verified session/bearer owner scopes records and dispatch; origin guard precedes browser mutation. Sources: `src/routes/api/mind/oauth/notion/status.ts` |
| `/api/mind/pairing/action` | POST | mixed_owner_device | sign: owner+origin+device ownership+halt; verify: device token+signed scope+halt; report/rotate: verified device token. Sources: `src/routes/api/mind/pairing/action.ts`, `src/lib/mind/pairing/pairing.server.ts` |
| `/api/mind/pairing/code` | POST | owner_origin | Owner session plus same-origin required before minting a short-lived pairing code. Sources: `src/lib/mind/pairing/pairing.server.ts`, `src/routes/api/mind/pairing/code.ts` |
| `/api/mind/pairing/handshake` | POST | paired_device | Single-use short-lived pairing code, public-key binding, attempt throttle and pinned origin/TLS when supplied. Sources: `src/routes/api/mind/pairing/handshake.ts`, `src/lib/mind/pairing/pairing.server.ts` |
| `/api/mind/pairing/heartbeat` | POST | paired_device | Device token/revocation and optional fingerprint required; no cookie authorization. Sources: `src/routes/api/mind/pairing/heartbeat.ts`, `src/lib/mind/pairing/pairing.server.ts` |
| `/api/mind/pairing/manifest` | GET, POST | public_verification | GET returns signed public agent manifest; POST op=verify checks supplied files/signature and performs no account mutation or command. Sources: `src/routes/api/mind/pairing/manifest.ts` |
| `/api/mind/pairing/status` | GET | owner_read | Verified session/bearer owner scopes records and dispatch; origin guard precedes browser mutation. Sources: `src/lib/mind/pairing/pairing.server.ts`, `src/routes/api/mind/pairing/status.ts` |
| `/api/mind/pairing/stop` | POST | mixed_owner_device | Stop: owner+origin or valid self-device token; clear: owner+origin. Resuming does not resurrect a revoked token. Sources: `src/routes/api/mind/pairing/stop.ts`, `src/lib/mind/pairing/pairing.server.ts` |
| `/api/mind/pc/approvals` | GET | owner_read | Verified session/bearer owner scopes records and dispatch; origin guard precedes browser mutation. Sources: `src/routes/api/mind/pc/approvals.ts` |
| `/api/mind/pc/approve` | POST | owner_origin | Verified session/bearer owner scopes records and dispatch; origin guard precedes browser mutation. Sources: `src/routes/api/mind/pc/approve.ts` |
| `/api/mind/pc/deny` | POST | owner_origin | Verified session/bearer owner scopes records and dispatch; origin guard precedes browser mutation. Sources: `src/routes/api/mind/pc/deny.ts` |
| `/api/mind/pc/events` | GET, POST | mixed_owner_device | GET verifies owner and job owner; POST verifies device token and exact job/agent association. Sources: `src/routes/api/mind/pc/events.ts` |
| `/api/mind/pc/jobs` | GET, POST | paired_device | Agent token and device/job binding protect delivery. Branch-checked jobs require the reviewed-source protocol and honor halt and cancellation. Sources: `src/routes/api/mind/pc/jobs.ts` |
| `/api/mind/pc/register` | DELETE, POST | mixed_owner_device | POST verifies owner+origin; DELETE verifies owner or explicit self-device token+origin before revocation. Sources: `src/routes/api/mind/pc/register.ts` |
| `/api/mind/pc/result` | POST | paired_device | Agent token and exact device/job association required; job transitions preserve halt/cancel/outcome authority. Sources: `src/routes/api/mind/pc/result.ts` |
| `/api/mind/pc/status` | GET, POST | owner_origin | Verified session/bearer owner scopes records and dispatch; origin guard precedes browser mutation. Sources: `src/routes/api/mind/pc/status.ts` |
| `/api/mind/providers` | GET, POST | owner_origin | Verified session/bearer owner scopes records and dispatch; origin guard precedes browser mutation. Sources: `src/routes/api/mind/providers.ts` |
| `/api/mind/queue-transfer` | POST | owner_origin | Authenticated same-origin transfer of held drafts inside the original owner and workspace scope. It confers no execution or connector permission. Sources: `src/routes/api/mind/queue-transfer.ts`, `src/lib/mind/queue-transfer.server.ts` |
| `/api/mind/receipts` | POST | owner_origin | Verified session/bearer owner scopes records and dispatch; origin guard precedes browser mutation. Sources: `src/routes/api/mind/receipts.ts` |
| `/api/mind/research-reports` | DELETE, GET, PATCH | owner_origin | Verified session/bearer owner scopes records and dispatch; origin guard precedes browser mutation. Sources: `src/lib/mind/research-http.server.ts` |
| `/api/mind/resources` | GET, PUT | owner_fetch_metadata | Verified session/bearer owner scopes records and dispatch; origin guard precedes browser mutation. Sources: `src/lib/mind/resource-http.server.ts` |
| `/api/mind/schedules/tick` | POST | schedule_worker | Rejects missing or mismatched worker authorization and checks stop state before a bounded pass. Sources: `src/lib/mind/schedule-tick.server.ts` |
| `/api/mind/session` | GET | session_probe | Returns the canonical signed-in owner, a signed-out response, an identity conflict or an unavailable status. Sources: `src/routes/api/mind/session.ts` |
| `/api/mind/sessions` | GET, POST | owner_origin | Lists the verified owner’s Better Auth devices and supports reviewed revocation of a specific device or all other sessions. Sources: `src/routes/api/mind/sessions.ts` |
| `/api/mind/shared-chats` | GET, POST | owner_origin | Owners list, issue and revoke their own grants. Signed-in readers must present a live link for the exact reviewed text. Sources: `src/routes/api/mind/shared-chats.ts` |
| `/api/mind/skills` | GET, POST, PUT | owner_origin | Verified session/bearer owner scopes records and dispatch; origin guard precedes browser mutation. Sources: `src/routes/api/mind/skills.ts` |
| `/api/mind/turn` | GET, POST | owner_fetch_metadata | Verified session/bearer owner scopes records and dispatch; origin guard precedes browser mutation. Sources: `src/lib/mind/turn.server.ts` |
| `/api/mind/usage` | DELETE, GET | owner_fetch_metadata | Isolation and owner checks cover usage history and confirmed retention deletion. Sources: `src/routes/api/mind/usage.ts` |
| `/api/mind/voice/call` | POST | owner_origin | Verified session/bearer owner scopes records and dispatch; origin guard precedes browser mutation. Sources: `src/lib/mind/voice/call.server.ts` |
| `/api/mind/voice/session` | POST | owner_fetch_metadata | Verified session/bearer owner scopes records and dispatch; origin guard precedes browser mutation. Sources: `src/lib/mind/voice/http.server.ts` |
| `/api/mind/voice/stt` | POST | owner_fetch_metadata | Verified session/bearer owner scopes records and dispatch; origin guard precedes browser mutation. Sources: `src/lib/mind/voice/http.server.ts` |
| `/api/mind/voice/tts` | POST | owner_fetch_metadata | Verified session/bearer owner scopes records and dispatch; origin guard precedes browser mutation. Sources: `src/lib/mind/voice/http.server.ts` |
| `/auth/callback` | GET | oauth_callback | Supabase PKCE/code exchange and safe redirect; active-identity continuity checked before replacing a session. Sources: `src/routes/auth/callback.tsx`, `src/lib/supabase/callback.server.ts` |

## Server functions

| Export | Method | Policy | Boundary |
|---|---|---|---|
| `src/lib/app-data/readiness.ts#getConnectorReadiness` | POST | public_status | Public boolean connector readiness only; POST is a read and cannot dispatch. |
| `src/lib/mind/custom-connection-fns.ts#callCustomConnectionFn` | POST | owner_rpc | Verified owner and isolation via authMiddleware; handler scopes records/dispatch by context.userId. |
| `src/lib/mind/custom-connection-fns.ts#listCustomConnectionsFn` | GET | owner_rpc | Verified owner and isolation via authMiddleware; handler scopes records/dispatch by context.userId. |
| `src/lib/mind/custom-connection-fns.ts#refreshCustomConnectionFn` | POST | owner_rpc | Refreshes the signed-in owner’s connection while honoring the stop state. |
| `src/lib/mind/custom-connection-fns.ts#saveCustomConnectionFn` | POST | owner_rpc | Verified owner and isolation via authMiddleware; handler scopes records/dispatch by context.userId. |
| `src/lib/mind/dashboard/owner-connections.ts#ownerConnections` | POST | owner_rpc | Verified owner and isolation via authMiddleware; handler scopes records/dispatch by context.userId. |
| `src/lib/mind/dashboard/owner-connections.ts#ownerNotionGraph` | POST | owner_rpc | The verified owner supplies the active workspace grant. Shared demo users are rejected and the public dashboard never receives this response. |
| `src/lib/mind/dashboard/require-dashboard-user.ts#requireDashboardUser` | GET | session_probe | Verified actual session and configured owner gate; signed-out redirects, disallowed owner returns forbidden. |
| `src/lib/mind/notion-workspaces.ts#listNotionWorkspaces` | GET | owner_rpc | Verified owner and isolation via authMiddleware; handler scopes records/dispatch by context.userId. |
| `src/lib/mind/notion-workspaces.ts#selectNotionWorkspace` | POST | owner_rpc | Verified owner and isolation via authMiddleware; handler scopes records/dispatch by context.userId. |
| `src/lib/mind/owner-keys-fns.ts#copyOwnerKeyFn` | POST | local_only | Origin-only middleware; underlying copy refuses hosted Vercel, absent request or non-loopback host. No remote credential-copy allowance. |
| `src/lib/mind/owner-keys-fns.ts#listOwnerKeySlotsFn` | GET | public_status | Public server slot presence and last-four metadata only; secret value requires separate local-only copy. |
| `src/lib/mind/rea.ts#reaDoctor` | POST | owner_rpc | Verified owner and isolation via authMiddleware; handler scopes records/dispatch by context.userId. |
| `src/lib/mind/rea.ts#reaInspect` | POST | owner_rpc | Verified owner and isolation via authMiddleware; handler scopes records/dispatch by context.userId. |
| `src/lib/mind/server.ts#analyzeImageFile` | POST | owner_rpc | Verified owner and isolation via authMiddleware; handler scopes records/dispatch by context.userId. |
| `src/lib/mind/server.ts#createMindMemory` | POST | owner_rpc | Verified owner and isolation via authMiddleware; handler scopes records/dispatch by context.userId. |
| `src/lib/mind/server.ts#createVoiceClientSecret` | POST | owner_rpc | Verified owner and isolation via authMiddleware; handler scopes records/dispatch by context.userId. |
| `src/lib/mind/server.ts#deleteMindMemory` | POST | owner_rpc | Verified owner and isolation via authMiddleware; handler scopes records/dispatch by context.userId. |
| `src/lib/mind/server.ts#editMindMemory` | POST | owner_rpc | Verified owner and isolation via authMiddleware; handler scopes records/dispatch by context.userId. |
| `src/lib/mind/server.ts#inspectWebPage` | POST | owner_rpc | Verified owner and isolation via authMiddleware; handler scopes records/dispatch by context.userId. |
| `src/lib/mind/server.ts#listMindMemories` | GET | owner_rpc | Verified owner and isolation via authMiddleware; handler scopes records/dispatch by context.userId. |
| `src/lib/mind/server.ts#loadAccountAttachment` | POST | owner_rpc | Verifies the current owner before accessing the associated account operation. |
| `src/lib/mind/server.ts#loadMindCopy` | POST | owner_rpc | Verified owner and isolation via authMiddleware; handler scopes records/dispatch by context.userId. |
| `src/lib/mind/server.ts#mcpCommand` | POST | owner_rpc | Verified owner and isolation via authMiddleware; handler scopes records/dispatch by context.userId. |
| `src/lib/mind/server.ts#mcpList` | GET | owner_rpc | Verified owner and isolation via authMiddleware; handler scopes records/dispatch by context.userId. |
| `src/lib/mind/server.ts#mcpRegistryCall` | POST | owner_rpc | Verified owner and isolation via authMiddleware; handler scopes records/dispatch by context.userId. |
| `src/lib/mind/server.ts#mcpRegistryList` | GET | optional_owner_rpc | Returns typed signed-out empty status; actual registry requires verified session/dev-only explicit identity policy. |
| `src/lib/mind/server.ts#mcpRegistryToggle` | POST | owner_rpc | Verified owner and isolation via authMiddleware; handler scopes records/dispatch by context.userId. |
| `src/lib/mind/server.ts#mcpRegistryTools` | GET | owner_rpc | Verified owner and isolation via authMiddleware; handler scopes records/dispatch by context.userId. |
| `src/lib/mind/server.ts#mcpRemove` | POST | owner_rpc | Verified owner and isolation via authMiddleware; handler scopes records/dispatch by context.userId. |
| `src/lib/mind/server.ts#mcpSave` | POST | owner_rpc | Verified owner and isolation via authMiddleware; handler scopes records/dispatch by context.userId. |
| `src/lib/mind/server.ts#mindStatus` | GET | public_status | Public readiness plus optional verified current-owner halt status; no credentials. |
| `src/lib/mind/server.ts#notionCommand` | POST | owner_rpc | Verified owner and isolation via authMiddleware; handler scopes records/dispatch by context.userId. |
| `src/lib/mind/server.ts#notionDisconnect` | POST | owner_rpc | Verified owner and isolation via authMiddleware; handler scopes records/dispatch by context.userId. |
| `src/lib/mind/server.ts#notionStatus` | GET | owner_rpc | Verified owner and isolation via authMiddleware; handler scopes records/dispatch by context.userId. |
| `src/lib/mind/server.ts#paperclipStatus` | GET | owner_rpc | Verified owner and isolation via authMiddleware; handler scopes records/dispatch by context.userId. |
| `src/lib/mind/server.ts#readExecutionControl` | GET | owner_rpc | Verified owner and isolation via authMiddleware; handler scopes records/dispatch by context.userId. |
| `src/lib/mind/server.ts#recordAgentExecution` | POST | owner_rpc | Verified owner and isolation via authMiddleware; handler scopes records/dispatch by context.userId. |
| `src/lib/mind/server.ts#refineDictationOptional` | POST | owner_rpc | Verified owner and isolation via authMiddleware; handler scopes records/dispatch by context.userId. |
| `src/lib/mind/server.ts#runDurableCorePass` | POST | owner_rpc | Verified owner and isolation via authMiddleware; handler scopes records/dispatch by context.userId. |
| `src/lib/mind/server.ts#runFleetModelStep` | POST | owner_rpc | Verifies the current owner before accessing the associated account operation. |
| `src/lib/mind/server.ts#saveAccountAttachment` | POST | owner_rpc | Verifies the current owner before accessing the associated account operation. |
| `src/lib/mind/server.ts#saveMindChanges` | POST | owner_rpc | Verifies the current owner before accessing the associated account operation. |
| `src/lib/mind/server.ts#saveMindCopy` | POST | owner_rpc | Verified owner and isolation via authMiddleware; handler scopes records/dispatch by context.userId. |
| `src/lib/mind/server.ts#searchWeb` | POST | owner_rpc | Verified owner and isolation via authMiddleware; handler scopes records/dispatch by context.userId. |
| `src/lib/mind/server.ts#sendTurn` | POST | owner_rpc | Verified owner and isolation via authMiddleware; handler scopes records/dispatch by context.userId. |
| `src/lib/mind/server.ts#setExecutionHalt` | POST | owner_rpc | Verified owner and isolation via authMiddleware; handler scopes records/dispatch by context.userId. |
| `src/lib/mind/server.ts#speakText` | POST | owner_rpc | Verified owner and isolation via authMiddleware; handler scopes records/dispatch by context.userId. |
| `src/lib/mind/server.ts#transcribeDictation` | POST | owner_rpc | Verified owner and isolation via authMiddleware; handler scopes records/dispatch by context.userId. |
| `src/lib/mind/server.ts#workerHealth` | GET | public_status | Public worker heartbeat freshness only; no worker action. |
| `src/lib/mind/voice-cloning/server.ts#vcsCreateChallenge` | POST | owner_rpc | Verified owner and isolation via authMiddleware; handler scopes records/dispatch by context.userId. |
| `src/lib/mind/voice-cloning/server.ts#vcsCreateProfile` | POST | owner_rpc | Verified owner and isolation via authMiddleware; handler scopes records/dispatch by context.userId. |
| `src/lib/mind/voice-cloning/server.ts#vcsDeleteProfile` | POST | owner_rpc | Verified owner and isolation via authMiddleware; handler scopes records/dispatch by context.userId. |
| `src/lib/mind/voice-cloning/server.ts#vcsExportAudio` | POST | owner_rpc | Verified owner and isolation via authMiddleware; handler scopes records/dispatch by context.userId. |
| `src/lib/mind/voice-cloning/server.ts#vcsExportConsent` | POST | owner_rpc | Verified owner and isolation via authMiddleware; handler scopes records/dispatch by context.userId. |
| `src/lib/mind/voice-cloning/server.ts#vcsGenerate` | POST | owner_rpc | Verified owner and isolation via authMiddleware; handler scopes records/dispatch by context.userId. |
| `src/lib/mind/voice-cloning/server.ts#vcsListProfiles` | GET | owner_rpc | Verified owner and isolation via authMiddleware; handler scopes records/dispatch by context.userId. |
| `src/lib/mind/voice-cloning/server.ts#vcsProviderStatus` | GET | public_status | Public configured provider capability/status only; profiles and synthesis use authenticated RPCs. |
| `src/lib/supabase/actions.ts#endSupabaseSession` | POST | credential_establishment | Ends the current browser’s Supabase session after verifying origin and reports cleanup failures. |
| `src/lib/supabase/actions.ts#getSupabaseAuthUser` | GET | session_probe | Supabase validates current session through getUser; public signed-out result contains no private account data. |
| `src/lib/supabase/actions.ts#requireDashboardUser` | GET | session_probe | Supabase validates current session through getUser; public signed-out result contains no private account data. |
| `src/lib/supabase/actions.ts#signInWithPassword` | POST | credential_establishment | Pre-login/sign-out action uses origin-only middleware, then Supabase credential/session SDK; no owner session prerequisite for login. |
| `src/lib/supabase/actions.ts#signOutSupabase` | POST | credential_establishment | Pre-login/sign-out action uses origin-only middleware, then Supabase credential/session SDK; no owner session prerequisite for login. |
| `src/lib/supabase/actions.ts#signUpWithPassword` | POST | credential_establishment | Pre-login/sign-out action uses origin-only middleware, then Supabase credential/session SDK; no owner session prerequisite for login. |
| `src/lib/supabase/actions.ts#startOAuth` | POST | credential_establishment | Pre-login/sign-out action uses origin-only middleware, then Supabase credential/session SDK; no owner session prerequisite for login. |

## Verification boundary

The inventory test checks the discovered handler surface against explicit policies and required guard call sites. Separate executable fixtures cover request isolation, OAuth state, owner continuity, device credential/job binding, durable halt and dispatch gates. Local-only key copy remains restricted to loopback and unavailable on hosted Vercel. Public manifest verification does not establish account or device authorization. OAuth callbacks retain their single-use state policy and must not be converted to an ordinary same-origin browser mutation.

Changes in this branch add missing origin checks to owner pairing mutations and the local PC action route, and add origin-only middleware to credential establishment/sign-out and local key copy. Device-only token routes and OAuth callbacks preserve their distinct guards.
