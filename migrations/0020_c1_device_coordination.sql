create table if not exists mind_pc_agents (
 agent_id text primary key, owner_id text not null, token_hash text not null unique,
 record jsonb not null, last_seen_at timestamptz not null default now()
);
create index if not exists mind_pc_agents_owner on mind_pc_agents(owner_id, last_seen_at);
create table if not exists mind_pc_jobs (
 job_id text primary key, owner_id text not null, agent_id text not null, status text not null,
 record jsonb not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists mind_pc_jobs_agent_queue on mind_pc_jobs(agent_id,status,created_at);
create index if not exists mind_pc_jobs_owner on mind_pc_jobs(owner_id,created_at desc);
create table if not exists mind_pc_events (
 event_id text primary key, owner_id text not null, job_id text not null, record jsonb not null,
 created_at timestamptz not null default now()
);
create index if not exists mind_pc_events_owner_job on mind_pc_events(owner_id,job_id,created_at,event_id);
