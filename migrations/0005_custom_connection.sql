-- One per-user MCP registry. Tokens are ciphertext (tokenEnc / envEnc), never plaintext.
-- Applied by the app when a durable Postgres URL is configured. Not run by this change.
create table if not exists mind_mcp_registry (
  user_id text not null,
  id text not null,
  record jsonb not null,
  primary key (user_id, id)
);
