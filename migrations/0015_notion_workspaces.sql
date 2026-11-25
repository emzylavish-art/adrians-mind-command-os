CREATE TABLE IF NOT EXISTS mind_notion_workspaces (
  owner_id text NOT NULL,
  workspace_id text NOT NULL,
  record jsonb NOT NULL,
  PRIMARY KEY (owner_id, workspace_id)
);
