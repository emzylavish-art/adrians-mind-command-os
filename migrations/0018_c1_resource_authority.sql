-- C1: owner-scoped shared reservations and recoverable responses. No provider keys.
create table if not exists mind_resource_policy (
  owner_id text primary key,
  revision integer not null default 1,
  policy jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists mind_resource_day (
  owner_id text not null,
  day text not null,
  calls integer not null default 0,
  reserved_usd_micros bigint not null default 0,
  calculated_usd_micros bigint not null default 0,
  tokens bigint not null default 0,
  primary key (owner_id, day)
);
create table if not exists mind_resource_operation (
  owner_id text not null,
  operation_id text not null,
  task_id text not null,
  provider text not null,
  model text not null,
  day text not null,
  status text not null default 'reserved',
  estimated_usd_micros bigint,
  reserved_usd_micros bigint not null default 0,
  calculated_usd_micros bigint,
  pricing_revision text,
  usage jsonb,
  request_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, operation_id)
);
create index if not exists mind_resource_operation_owner_created on mind_resource_operation(owner_id, created_at desc);
alter table mind_turn_receipt add column if not exists response_body text;
alter table mind_turn_receipt add column if not exists response_status integer;
alter table mind_turn_receipt add column if not exists response_type text;
