create table if not exists mind_notification_target (
  id uuid primary key,
  user_id text not null references "user"(id) on delete cascade,
  channel text not null check (channel in ('push', 'email')),
  device_id uuid,
  endpoint text unique,
  destination jsonb not null,
  preferences jsonb not null,
  enabled_at timestamptz not null default now(),
  last_checked timestamptz,
  unique (user_id, channel, device_id),
  check ((channel = 'push') = (endpoint is not null and device_id is not null)),
  check (channel <> 'email' or (endpoint is null and device_id is null))
);
create unique index if not exists mind_notification_email_owner
  on mind_notification_target (user_id) where channel = 'email';
create index if not exists mind_notification_target_due
  on mind_notification_target (last_checked nulls first, id);

create table if not exists mind_notification_delivery (
  target_id uuid not null references mind_notification_target(id) on delete cascade,
  event_hash text not null,
  urgent boolean not null,
  state text not null check (state in ('attempted', 'accepted', 'rejected', 'unknown')),
  attempted_at timestamptz not null default now(),
  primary key (target_id, event_hash)
);
create index if not exists mind_notification_delivery_age on mind_notification_delivery (attempted_at);
alter table mind_notification_target enable row level security;
alter table mind_notification_delivery enable row level security;
