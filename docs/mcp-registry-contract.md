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

## Not in this contract

Gmail stays `GET /api/mind/oauth/gmail/status`. This registry does not start Google sign-in and does not read or send mail. The older Connected-form file `.data/mind-mcp` (`src/lib/mind/mcp.ts`) is a separate store and is unchanged.
