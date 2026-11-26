CREATE TABLE IF NOT EXISTS mind_media_operations (
  owner_id text NOT NULL,
  id text NOT NULL,
  kind text NOT NULL,
  payload_hash text NOT NULL,
  chat_id text,
  state text NOT NULL DEFAULT 'dispatching',
  result_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, id)
);
CREATE INDEX IF NOT EXISTS mind_media_operations_owner_recent ON mind_media_operations (owner_id, created_at DESC);
