create table if not exists mind_custom_connection (
  user_id text not null,
  id text not null,
  record jsonb not null,
  primary key (user_id, id)
);
