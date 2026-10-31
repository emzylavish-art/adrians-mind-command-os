create table if not exists mind_tool_run (
  user_id text not null,
  id text not null,
  tool text not null,
  action text not null,
  ok boolean not null,
  detail text not null,
  at timestamptz not null default now(),
  primary key (user_id, id)
);
