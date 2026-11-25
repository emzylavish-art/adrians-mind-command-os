CREATE TABLE IF NOT EXISTS mind_mcp_call_approvals (
  approval_id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  request_hash text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS mind_mcp_call_approval_expiry ON mind_mcp_call_approvals(expires_at);
