-- Separate discovery, inference proof and temporary cooldown without replacing saved selections.
alter table mind_ai_providers add column if not exists catalog_checked_at timestamptz;
alter table mind_ai_providers add column if not exists inference_verified_at timestamptz;
alter table mind_ai_providers add column if not exists inference_model text not null default '';
alter table mind_ai_providers add column if not exists inference_failed_at timestamptz;
alter table mind_ai_providers add column if not exists retry_after timestamptz;
alter table mind_ai_providers add column if not exists rate_limit_model text not null default '';
alter table mind_ai_providers add column if not exists model_capabilities jsonb not null default '{}'::jsonb;
