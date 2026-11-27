-- Accepted provider jobs are recoverable without a second generation request.
create table if not exists mind_media_jobs (
  owner_id text not null,
  operation_id uuid not null,
  chat_id text not null default '',
  request_id text not null default '',
  prompt text not null default '',
  settings jsonb not null,
  state text not null,
  model text not null default '',
  result_url text not null default '',
  error text not null default '',
  temporary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz,
  primary key (owner_id, operation_id)
);
create index if not exists mind_media_jobs_owner_request on mind_media_jobs(owner_id, request_id);
