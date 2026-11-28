-- Only a digest and the source reference are stored. Chat content stays in the owner's workspace.
create table if not exists mind_chat_shared_link (
  link_hash text primary key,
  owner_id text not null,
  chat_id text not null,
  content_hash text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index if not exists mind_chat_shared_owner on mind_chat_shared_link(owner_id, created_at desc);
alter table mind_chat_shared_link enable row level security;
