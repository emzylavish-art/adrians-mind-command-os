-- C1 AA-002: identity metadata belongs to one authorization generation.
ALTER TABLE mind_oauth_connections ADD COLUMN IF NOT EXISTS grant_generation text;
ALTER TABLE mind_oauth_connections ADD COLUMN IF NOT EXISTS external_account_id text;
UPDATE mind_oauth_connections SET grant_generation = gen_random_uuid()::text WHERE grant_generation IS NULL;

-- C1 AA-001: resource-specific observations, never credentials or page content.
CREATE TABLE IF NOT EXISTS mind_notion_operation_status (
  owner_id text NOT NULL,
  workspace_id text NOT NULL,
  page_id text NOT NULL DEFAULT '',
  operation text NOT NULL,
  grant_generation text NOT NULL,
  outcome jsonb NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id, workspace_id, page_id, operation)
);
