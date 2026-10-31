create table if not exists mind_snapshot (
  user_id text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists mind_control (
  user_id text primary key,
  halted boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists mind_project (
  user_id text not null,
  id text not null,
  name text not null,
  description text not null default '',
  created_at timestamptz not null,
  primary key (user_id, id)
);

create table if not exists mind_chat (
  user_id text not null,
  id text not null,
  project_id text,
  title text not null,
  memory text not null,
  autonomy text not null,
  temporary boolean not null default false,
  messages jsonb not null,
  retrieval_log jsonb not null,
  primary key (user_id, id)
);

create table if not exists mind_memory (
  user_id text not null,
  id text not null,
  scope text not null,
  project_id text,
  chat_id text,
  body text not null,
  source text not null,
  archived boolean not null default false,
  versions jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (user_id, id)
);

create table if not exists mind_file (
  user_id text not null,
  id text not null,
  project_id text,
  name text not null,
  bytes integer not null,
  text_copy text not null,
  created_at timestamptz not null,
  primary key (user_id, id)
);

create table if not exists mind_audit (
  user_id text not null,
  id text not null,
  at timestamptz not null,
  action text not null,
  target text not null,
  result text not null,
  primary key (user_id, id)
);

create table if not exists mind_usage (
  user_id text not null,
  id text not null,
  chat_id text,
  at timestamptz not null,
  model text not null,
  request_id text,
  prompt_tokens integer,
  completion_tokens integer,
  primary key (user_id, id)
);
