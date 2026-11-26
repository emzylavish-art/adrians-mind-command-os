create table if not exists mind_research_report (
  owner_id text not null,
  report_id text not null,
  revision integer not null check (revision > 0),
  question text not null,
  tags jsonb not null default '[]'::jsonb,
  project_id text,
  result jsonb not null,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, report_id)
);
create index if not exists mind_research_report_owner_updated on mind_research_report(owner_id, updated_at desc, report_id);
create table if not exists mind_research_report_version (
  owner_id text not null,
  report_id text not null,
  revision integer not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, report_id, revision),
  foreign key (owner_id, report_id) references mind_research_report(owner_id, report_id) on delete cascade
);
create table if not exists mind_skill_preferences (
  owner_id text primary key,
  revision integer not null default 0,
  preferences jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create table if not exists mind_skill_execution (
  owner_id text not null,
  execution_id text not null,
  skill_id text not null,
  skill_revision text not null,
  agent_id text not null,
  status text not null check (status in ('instructions_loaded', 'failed')),
  detail text not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, execution_id)
);
create index if not exists mind_skill_execution_owner_time on mind_skill_execution(owner_id, created_at desc);
