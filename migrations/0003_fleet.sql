create table if not exists mind_agent (
  user_id text not null,
  id text not null,
  name text not null,
  version integer not null default 1,
  body jsonb not null,
  primary key (user_id, id)
);

create table if not exists mind_agent_run (
  user_id text not null,
  id text not null,
  agent_id text not null,
  parent_id text,
  state text not null,
  body jsonb not null,
  primary key (user_id, id)
);

create table if not exists mind_agent_event (
  user_id text not null,
  id text not null,
  run_id text not null,
  at timestamptz not null,
  kind text not null,
  detail text not null,
  primary key (user_id, id)
);

create table if not exists mind_connection (
  user_id text not null,
  id text not null,
  provider text not null,
  label text not null,
  status text not null,
  primary key (user_id, id)
);

create table if not exists mind_mailbox (
  user_id text not null,
  id text not null,
  label text not null,
  address text not null,
  status text not null,
  primary key (user_id, id)
);

create table if not exists mind_schedule (
  user_id text not null,
  id text not null,
  name text not null,
  agent_id text,
  next_run_at timestamptz,
  enabled boolean not null default true,
  primary key (user_id, id)
);

create table if not exists mind_deployment (
  user_id text not null,
  id text not null,
  agent_id text not null,
  target text not null,
  state text not null,
  primary key (user_id, id)
);
