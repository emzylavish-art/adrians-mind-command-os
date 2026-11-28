create table if not exists mind_account_photo (
  user_id text primary key,
  data_url text check (char_length(data_url) <= 160000),
  revision uuid not null default gen_random_uuid()
);
alter table mind_account_photo enable row level security;
