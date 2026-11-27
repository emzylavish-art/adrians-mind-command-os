-- Separate from workspace snapshots: stale tabs cannot overwrite account privacy.
create table if not exists mind_memory_policy (
  user_id text primary key,
  suspended boolean not null default false,
  revision bigint not null default 1,
  updated_at timestamptz not null default now()
);
