-- Account-owned bytes live outside the bounded workspace metadata snapshot.
create table if not exists mind_account_attachment (
  user_id text not null,
  id text not null,
  data_url text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);
