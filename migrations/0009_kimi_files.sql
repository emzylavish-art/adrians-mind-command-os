create table if not exists mind_kimi_file (
  user_id text not null,
  path text not null,
  text_copy text not null,
  bytes integer not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, path)
);
