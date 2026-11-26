-- Bind explicit retries of provably unsent video requests without retaining Temporary prompt text.
alter table mind_media_jobs add column if not exists request_hash text not null default '';
alter table mind_media_jobs add column if not exists project_id text not null default '';
alter table mind_media_jobs add column if not exists task_id text not null default '';
