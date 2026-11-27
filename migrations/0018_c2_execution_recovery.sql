-- C2 audit: receipts and recovery metadata. No credentials or provider content.
alter table mind_tool_run add column if not exists metadata jsonb not null default '{}';

create table if not exists mind_execution_receipt (
  owner_id text not null,
  id text not null,
  outcome jsonb not null,
  issued_at_ms bigint not null,
  recorded_at timestamptz,
  primary key (owner_id, id)
);

create table if not exists mind_rate_window (
  owner_id text not null,
  bucket text not null,
  window_ms bigint not null,
  window_started_ms bigint not null,
  request_count integer not null,
  primary key (owner_id, bucket, window_ms)
);

create table if not exists mind_notion_operation (
  owner_id text not null,
  id text not null,
  workspace_id text not null,
  fingerprint text not null,
  page jsonb not null,
  state text not null check (state in ('prepared', 'dispatched', 'accepted', 'verified', 'rejected', 'uncertain')),
  block_ids jsonb not null default '[]',
  updated_at timestamptz not null default now(),
  primary key (owner_id, id)
);

create table if not exists mind_oauth_recovery (
  owner_id text not null,
  connector text not null,
  connection_at text not null,
  status text not null,
  detail text not null,
  at timestamptz not null default now(),
  primary key (owner_id, connector, connection_at)
);

alter table mind_oauth_connections add column if not exists expires_at timestamptz;
alter table mind_oauth_connections add column if not exists scope_source text;

create table if not exists mind_oauth_refresh_claim (
  owner_id text not null,
  connector text not null,
  workspace_id text not null,
  claim text not null,
  expires_at timestamptz not null,
  primary key (owner_id, connector, workspace_id)
);
