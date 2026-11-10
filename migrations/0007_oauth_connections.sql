-- Owner-scoped OAuth records for serverless production.
CREATE TABLE IF NOT EXISTS mind_oauth_connections (
 owner_id text NOT NULL,
 connector text NOT NULL,
 access_token_enc text NOT NULL,
 refresh_token_enc text,
 workspace_name text,
 workspace_id text,
 bot_id text,
 account_label text,
 connected_at timestamptz NOT NULL DEFAULT now(),
 token_type text,
 scopes text,
 PRIMARY KEY (owner_id, connector)
);
CREATE TABLE IF NOT EXISTS mind_oauth_pending (
 state_hash text PRIMARY KEY,
 owner_id text NOT NULL,
 connector text NOT NULL,
 code_verifier_enc text NOT NULL,
 redirect_uri text NOT NULL,
 scopes text,
 created_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS mind_oauth_pending_expiry_idx ON mind_oauth_pending(expires_at);
