create table if not exists mind_composer_queue_transfer (
  user_id text not null references "user" (id) on delete cascade,
  scope text not null,
  cue_id text not null,
  payload jsonb,
  digest text not null,
  claim_id text,
  state text not null default 'waiting' check (state in ('waiting', 'claimed', 'received', 'cancelled')),
  created_at timestamptz not null default now(),
  primary key (user_id, scope, cue_id),
  check ((state in ('waiting', 'claimed')) = (payload is not null))
);
create index if not exists mind_composer_queue_transfer_live
  on mind_composer_queue_transfer (user_id, scope, created_at)
  where state in ('waiting', 'claimed');
alter table mind_composer_queue_transfer enable row level security;
