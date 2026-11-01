-- Pattern proposals: Evolution proposes NEW patterns; Perception accepts/rejects into patterns.
-- Service-role only (RLS on, no anon/authenticated policies). Idempotent.

CREATE TABLE IF NOT EXISTS pattern_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger text NOT NULL,
  prediction text NOT NULL,
  confidence real NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  evidence jsonb,
  proposed_by text DEFAULT 'evolution',
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'accepted', 'rejected')),
  accepted_pattern_id uuid REFERENCES patterns(id) ON DELETE SET NULL,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pattern_proposals_status_idx ON pattern_proposals (status);

ALTER TABLE pattern_proposals ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
