# MCP registry contract

This is the source contract for the Tools registry (`mcpRegistryList`), `GET`/`POST /api/mind/mcp/servers`, and `POST /api/mind/mcp/call`. It is not a deployment record. Nothing here has been migrated or deployed.

## One store

Per-user rows live in `mind_mcp_registry` (`user_id`, `id`, `record jsonb`), created by `migrations/0005_custom_connection.sql` when the app applies migrations. The Tools list, the REST server list, registry toggle/register/remove, and custom MCP/HTTP connections all read and write that table.

`listRegistryServers` returns `RegistryServerPublic[]`, including the built-in server `builtin-mind`. `GET /api/mind/mcp/servers` wraps that array as `{ ok: true, servers }`. `mcpRegistryList` wraps it as `{ status: "ok", servers }` and adds `persistence: "missing_config"` when no database URL is configured. Custom connections are the same rows with a URL, exposed as `PublicConnection` (kind `mcp` or `http`, operations, `hasToken`).

The built-in server is always present. `pglite_list_schema` takes `{ type: "object", properties: {}, required: [] }`. `pglite_query` takes `{ sql: string }`. Remote `tools/list` schemas are copied onto `ListedTool.inputSchema`. A missing object schema is not called with `{ text }`.

## When there is no database

`DATABASE_URL` or `POSTGRES_URL` must be set. If neither is set, register, save, toggle, and remove return `missing_config` and do not create `.data/mind-mcp-registry`. The list still shows the built-in server. A legacy JSON file, if one exists on that machine, is shown read-only and is not rewritten.

There is no production fallback that pretends a file write is durable.

## Legacy files

Old installs stored `{ servers: [...] }` at `.data/mind-mcp-registry/<sha256(userId)>.json`, with a plaintext `token` and `env` inside the file.

When a database URL is configured:

- Rows already in `mind_mcp_registry` stay as they are. The file does not overwrite them.
- Server ids that exist only in the file are inserted once if every secret can be sealed.
- The file is not deleted, truncated, or rewritten. It remains a backup.
- If `CONNECTOR_TOKEN_SECRET` is missing or shorter than 16 characters, secrets are not copied. The file is left byte-for-byte unchanged, the database is not given those rows, and the list still shows the label and URL. A call that needs the secret returns `missing_config` and does not send the old plaintext token.
- A later request, after the secret is set, inserts the missing ids and seals them. The file is still left in place.

A database row that already contains a plaintext `token` field is not used. The value is not returned and is not copied into a new plaintext column.

## Token custody

| Stage | What is stored | Who can see it |
| --- | --- | --- |
| Save | AES-256-GCM ciphertext in `record.tokenEnc` or `record.envEnc`, using `CONNECTOR_TOKEN_SECRET` from `src/lib/mind/connectors/crypto.ts` | Server process only |
| List / REST / Tools UI | `hasToken` and `envKeys` | Signed-in owner |
| Call | Decrypted in memory for the `Authorization` header, then discarded | Upstream server |
| Logs and errors | Token text replaced with `[redacted]` | Operator |
| Delete | The row is deleted | — |

No key is invented. If `CONNECTOR_TOKEN_SECRET` is unset or shorter than 16 characters, a save that includes a bearer token or a stdio env map fails with `missing_config` and writes nothing. Replacing a token writes a new ciphertext. A failed decrypt (`secretUnreadable`) does not call the upstream server.

Queries are `where user_id = $1`. One owner cannot list or call another owner's row. The in-memory test double used by unit tests is process-local and is not the production store.

## Call result

`McpCallContract` in `src/lib/mind/mcp/call-contract.ts`:

- Kept: `ok`, `status`, `serverId`, `tool`, `text`, optional `data`.
- `code`: `ok | error | unauthorized | missing_config | incompatible | ssrf_denied | timeout | disabled`.
- `transport`: `{ ok, status, ms }` for an upstream HTTP exchange, or `null` when the call never left the process.
- `rpc`: `{ isError, content, structuredContent }` copied from the upstream JSON-RPC result, or `null` when there was no JSON-RPC result.

`content` keeps non-text parts (`image`, `resource`, and any other `type` the server sent). `text` is only the joined `type: "text"` parts, for older callers.

`transport.ok` is false for HTTP 401/403, timeouts, DNS refusal, and unreachable hosts. `rpc` is null in those cases. `code` is `unauthorized` only for 401/403.

A JSON-RPC `error` object, or a tool result with `isError: true`, keeps `transport.ok` true when the HTTP status is 2xx, and puts the upstream payload on `rpc`. That is an application error, not an authorization failure.

`/api/mind/mcp/call` still returns HTTP 200 after a tool attempt. Sign-in remains 401. A cross-site POST remains 403. Emergency stop remains 403.

There is no `requestId`, `correlationId`, or trace field on `McpCallContract`. `transport.ms` is elapsed milliseconds for that one attempt. The Tools form adds `localAttemptId` for the click and sets `upstreamRequestId` to null. That id is not read from a response header.

## Acceptance answers

Backend contract version `MCP_BACKEND_CONTRACT_VERSION` is a candidate only. It is not frozen. Mounted failure-banner tests do not exist on this branch.

1. `safeReason(code)` returns one fixed line and ignores the upstream body. Native JSON-RPC stays on `rpc` for a successful data result.
2. `localAttemptId` is local. `upstreamRequestId` is null. No `x-request-id` header is read.
3. `missingConfigNotice` returns `Not configured. Nothing was retried.` and `retryable: false` when the database URL or token secret is missing.
4. Custom HTTP aborts once at 15 seconds and drops an oversized body. It does not send the request again. `READ_SAFE_ALLOWLIST` is `pglite_list_schema`. Custom HTTP GET `request` is the other read. `timeoutRetryDecision` returns `bannerRetry: false` for a timeout or transport failure even when the tool is on that allowlist. A candidate consumer banner would offer one manual Retry for safe reads. This version does not. Consumers have not agreed, and the envelope is not frozen.
5. Not accepted and not frozen. `src/lib/mind/failure-mount.ts` exists on `logic-picker-routes` at `a86d33d` (`registerFailureHandler`, `emitFailure`, `MountedFailure`) and is absent here. This lane does not import it. `command-app.tsx` and `fleet-panels.tsx` are Logic-owned, so this lane cannot register the `mcp` surface on the mounted page. Helper tests of `acceptResult` are not mounted tests. Logic must call `registerFailureHandler("mcp", handler)` from the mounted UI after that file is on the branch this app runs.

## Error text

Generated errors do not include the saved URL, query string, `Authorization` header, or bearer token. `privacyErrorText` in `src/lib/mind/mcp/call-contract.ts` is applied to upstream JSON-RPC error messages before they are copied to `text` and `rpc.content`. It replaces the stored bearer with `[redacted]`, replaces `authorization` / `cookie` / `set-cookie` / `proxy-authorization` assignments with `[redacted]`, and replaces `scheme://...` literals with `[url]`.

Successful tool text still strips the stored bearer and can contain URLs the tool itself returned. That text is not passed through `privacyErrorText`.

## Missing configuration

These strings are the ones the source returns. No other prerequisite copy is invented.

- No `DATABASE_URL` or `POSTGRES_URL`: `No durable database is configured (DATABASE_URL or POSTGRES_URL). Nothing was saved.` `mcpRegistryList` also sets `persistence: "missing_config"` and does not add a second sentence.
- `CONNECTOR_TOKEN_SECRET` unset: `CONNECTOR_TOKEN_SECRET is not set. Tokens cannot be stored encrypted. Nothing was saved.`
- Secret shorter than 16 characters: `CONNECTOR_TOKEN_SECRET is too short (need ≥16 characters). Tokens cannot be stored. Nothing was saved.`
- Legacy file with a secret and no usable sealing key: `CONNECTOR_TOKEN_SECRET is not set, so a legacy secret was not copied. The legacy file was left unchanged. Nothing was saved.`
- Ciphertext cannot be decrypted: `The saved credential cannot be decrypted. Set CONNECTOR_TOKEN_SECRET and save the token again. Nothing was called.`
- Bearer selected and no token entered: `Bearer auth needs a token stored on the server. Nothing was saved.`
- Bearer selected and the stored token is not usable at call time: `Bearer auth is selected and no usable token is stored. Nothing was called.`

Gmail is not configured here. The existing status route is `GET /api/mind/oauth/gmail/status`. This registry does not register a Google client and does not read or send mail.

## Timeout and retry

Remote JSON-RPC uses one attempt. `HTTP_RPC_TIMEOUT_MS` is 15000. The timer aborts that attempt. The result is `code: "timeout"`, `transport.ok: false`, `transport.status: 0`, and `rpc: null`. The function does not call again.

Custom HTTP `send` has no timer and no second attempt. A hung request waits until the platform closes it.

MCP `tools/call` and custom HTTP POST run only after `confirmed === true`. Custom HTTP GET does not require that flag. None of these paths retry a timed-out, failed, or unknown tool. The server does not mark a tool idempotent and does not retry reads. A later click is a new call, not an automatic retry.

`src/lib/mind/mcp-call-action.ts` is a separate Tools-panel control for one built-in `pglite_query` (`SELECT 1 AS n`). Its Retry button is a user click that repeats those same arguments. This lane does not mount that banner and does not change it. It is not a retry of custom MCP or custom HTTP.

## Connected screen

The Tools panel already mounts `CustomConnections` from `src/components/mind/fleet-panels.tsx`. That file is now reserved by logic-picker-routes and was not edited again. The form calls `listCustomConnectionsFn`, `saveCustomConnectionFn`, and `callCustomConnectionFn`. Saving an MCP URL runs `initialize` and `tools/list`, then the form renders each operation, its argument fields, and `Result ({status}): {text}`. It does not mount the failure banner.

The Connected screen in `src/components/mind/command-app.tsx` still calls `mcpSave`, `mcpList`, and `mcpRemove`. Those handlers live in `src/lib/mind/server.ts`, which logic-picker-routes also owns. This lane did not retarget them. They still use the older `.data/mind-mcp` helpers in `src/lib/mind/mcp.ts`. A registry load can read that file and copy missing ids only when `CONNECTOR_TOKEN_SECRET` can seal every secret. The file is not deleted. Until `server.ts` awaits a registry-backed `listMcp` / `saveMcp` / `probeMcp` / `removeMcp`, the Connected screen does not write `mind_mcp_registry`.

## Tests in this lane

`src/lib/mind/custom-connection.test.ts` checks the shared rows, the call envelope (`code`, `transport`, `rpc`, including an image part), unauthorized versus JSON-RPC errors, missing secret, missing database, legacy registry import, and `privacyErrorText`.

`src/lib/mind/mcp-entrypoints.test.ts` checks the Tools form source (save, list, call, and the result line), that `fleet-panels.tsx` mounts `CustomConnections`, that `command-app.tsx` still calls `mcpSave`, and that a Connected-form legacy file is imported only when it can be sealed.

No test in this lane mounts the failure banner, `mcp-call-action`, or a browser. Those surfaces were not edited. `npm ci --ignore-scripts` failed with `Exit handler never called!`, so `@modelcontextprotocol/sdk` is not installed and `src/lib/mind/mcp/registry.test.ts` was not run.

## Not a deployment record

Nothing here has been migrated or deployed. PR 30 is not production. Live browser proof was not run. Gmail OAuth was not started. The reported production lines `PGLite query error: self-signed certificate in certificate chain` and `Forbidden: cross-site request blocked` were not reproduced against a live database. In source, `pgliteQuery` prefixes the driver message, and `src/lib/db.ts` opens `pg.Pool` from the URL while `src/lib/auth/pg-pool.ts` uses `rejectUnauthorized: true` plus the Supabase root. This lane did not change either file. `assertSameSiteRequest` throws `Forbidden: cross-site request blocked` for scripted `cross-site` and `same-site` requests. `GET /api/mind/mcp/servers` does not call it.
