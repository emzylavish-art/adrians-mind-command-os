-- Dispatch receipts contain no conversation text or provider credentials.
create table if not exists mind_turn_receipt (
  user_id text not null,
  operation_id text not null,
  request_hash text not null,
  expires_at timestamptz not null,
  responded boolean not null default false,
  primary key (user_id, operation_id)
);

create index if not exists mind_turn_receipt_expiry on mind_turn_receipt (expires_at);
alter table mind_turn_receipt enable row level security;
