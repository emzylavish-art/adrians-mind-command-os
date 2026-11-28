create table if not exists mind_notification_mark (
  user_id text not null references mind_snapshot(user_id) on delete cascade,
  notice_key text not null check (notice_key ~ '^[0-9a-f]{64}$'),
  visibility integer not null check (visibility in (1,2)),
  marked_at timestamptz not null default now(),
  primary key (user_id,notice_key)
);
create index if not exists mind_notification_mark_recent
  on mind_notification_mark(user_id,marked_at desc,notice_key);
alter table mind_notification_mark enable row level security;
