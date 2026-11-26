-- Preserve model capability metadata separately from the legacy model-id list.
ALTER TABLE mind_ai_providers ADD COLUMN IF NOT EXISTS model_profiles jsonb NOT NULL DEFAULT '{}'::jsonb;
