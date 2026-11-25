alter table mind_turn_receipt add column if not exists retryable boolean not null default false;
