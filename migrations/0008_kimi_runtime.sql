-- Kimi runtime records that do not already exist in 0001-0007.
-- Reuse "user", mind_project, mind_file, mind_audit, mind_usage,
-- mind_ai_providers, and mind_mcp_registry. Do not store secrets here.

create table if not exists mind_kimi_runtime (
  user_id text not null,
  id text not null,
  target text not null,
  version text not null default '',
  status text not null,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists mind_kimi_session (
  user_id text not null,
  id text not null,
  project_id text,
  runtime_id text,
  kimi_session_id text,
  title text not null default '',
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists mind_kimi_event (
  user_id text not null,
  id text not null,
  session_id text not null,
  seq integer not null,
  kind text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, id),
  unique (user_id, session_id, seq)
);

create table if not exists mind_kimi_approval (
  user_id text not null,
  id text not null,
  session_id text not null,
  action text not null,
  content_hash text not null,
  state text not null,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  primary key (user_id, id)
);

create table if not exists mind_kimi_extension (
  user_id text not null,
  id text not null,
  kind text not null,
  name text not null,
  version text not null default '',
  state text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists mind_kimi_session_project_idx on mind_kimi_session (user_id, project_id);
create index if not exists mind_kimi_event_session_idx on mind_kimi_event (user_id, session_id, seq);
