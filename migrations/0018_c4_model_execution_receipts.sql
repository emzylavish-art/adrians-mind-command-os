-- Receipts contain identifiers and provider-reported counters, never prompts or answers.
create table if not exists mind_model_execution (
  user_id text not null,
  execution_id text not null,
  operation_id text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, execution_id)
);
create index if not exists mind_model_execution_operation on mind_model_execution (user_id, operation_id);
