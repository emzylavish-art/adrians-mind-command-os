-- Explicit metadata discovery only. Credentials and generated content are never stored here.
create table if not exists mind_environment_model_catalogs (
  user_id text not null,
  provider text not null,
  credential_fingerprint text not null,
  state text not null check (state in ('catalogued', 'unavailable')),
  models jsonb not null default '[]'::jsonb,
  capabilities jsonb not null default '{}'::jsonb,
  last_error text not null default '',
  checked_at timestamptz not null default now(),
  primary key (user_id, provider)
);
