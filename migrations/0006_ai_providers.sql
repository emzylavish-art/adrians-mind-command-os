-- Owner-scoped bring-your-own-model registry. Never store plaintext credentials.
create table if not exists mind_ai_providers (
  user_id text not null,
  id text not null,
  label text not null,
  base_url text not null,
  key_ciphertext text not null,
  default_model text not null,
  models jsonb not null default '[]'::jsonb,
  status text not null default 'configured',
  last_error text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
