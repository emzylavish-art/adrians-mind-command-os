create table if not exists mind_managed_browser (
  id uuid primary key,
  user_id text not null references "user"(id) on delete cascade,
  origin text not null,
  mode text not null check (mode in ('managed','takeover','stopped','unconfirmed')),
  operation text not null,
  pending uuid,
  updated_at timestamptz not null default now(),
  ended_at timestamptz
);
create unique index if not exists mind_managed_browser_active_owner on mind_managed_browser(user_id) where ended_at is null;
create table if not exists mind_managed_browser_receipt (
  id uuid primary key,
  session_id uuid not null references mind_managed_browser(id) on delete cascade,
  action text not null,
  outcome text not null check (outcome in ('attempted','confirmed','rejected','unconfirmed')),
  recorded_at timestamptz not null default now()
);
alter table mind_managed_browser enable row level security;
alter table mind_managed_browser_receipt enable row level security;
