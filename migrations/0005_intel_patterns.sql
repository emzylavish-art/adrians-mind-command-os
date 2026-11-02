-- Intel pattern store: evolution-managed predictions with outcome + confidence audit trail.
-- Service-role only: RLS enabled, no anon/authenticated policies (service_role bypasses RLS).
-- Idempotent: safe to re-run.
-- UUIDs use core gen_random_uuid() (Postgres 13+ / PGLite) — do not require pgcrypto.

CREATE TABLE IF NOT EXISTS patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger text NOT NULL,
  prediction text NOT NULL,
  confidence real NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  last_verified_at timestamptz,
  source text,
  status text DEFAULT 'active',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS patterns_status_idx ON patterns (status);
CREATE INDEX IF NOT EXISTS patterns_confidence_idx ON patterns (confidence);

CREATE TABLE IF NOT EXISTS pattern_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_id uuid NOT NULL REFERENCES patterns(id) ON DELETE CASCADE,
  hit boolean NOT NULL,
  observed_at timestamptz DEFAULT now(),
  note text
);

CREATE INDEX IF NOT EXISTS pattern_outcomes_pattern_id_idx ON pattern_outcomes (pattern_id);

CREATE TABLE IF NOT EXISTS pattern_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_id uuid NOT NULL REFERENCES patterns(id) ON DELETE CASCADE,
  old_confidence real,
  new_confidence real CHECK (new_confidence >= 0 AND new_confidence <= 1),
  reason text,
  adjusted_by text DEFAULT 'evolution',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pattern_adjustments_pattern_id_idx ON pattern_adjustments (pattern_id);

ALTER TABLE patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE pattern_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE pattern_adjustments ENABLE ROW LEVEL SECURITY;
-- No policies for anon/authenticated — PostgREST service_role bypasses RLS.

NOTIFY pgrst, 'reload schema';
