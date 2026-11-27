-- Independent of the replaceable workspace snapshot and its 200-row UI cache.
create table if not exists mind_usage_ledger (
  user_id text not null,
  operation_id text not null,
  stage text not null,
  at timestamptz not null default now(),
  payload jsonb not null,
  primary key (user_id, operation_id, stage)
);
create index if not exists mind_usage_ledger_owner_at on mind_usage_ledger (user_id, at desc, operation_id, stage);
