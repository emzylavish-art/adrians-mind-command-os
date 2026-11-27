CREATE TABLE IF NOT EXISTS mind_financial_policy (
  user_id text PRIMARY KEY,
  policy jsonb NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mind_financial_ledger (
  user_id text NOT NULL,
  id text NOT NULL,
  operation_id text NOT NULL,
  request_hash text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  project_id text,
  task_id text NOT NULL,
  reserved_micros bigint NOT NULL CHECK (reserved_micros >= 0),
  actual_micros bigint CHECK (actual_micros >= 0),
  state text NOT NULL CHECK (state IN ('reserved','unknown','settled','released')),
  cost_basis text NOT NULL CHECK (cost_basis IN ('owner_estimate','verified_free','provider_reported','owner_invoice')),
  provider_request_id text,
  invoice_ref text,
  day_bucket text NOT NULL,
  week_bucket text NOT NULL,
  month_bucket text NOT NULL,
  policy_revision integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id,id),
  UNIQUE (user_id,operation_id)
);
CREATE INDEX IF NOT EXISTS mind_financial_ledger_owner_month ON mind_financial_ledger(user_id,month_bucket);
CREATE TABLE IF NOT EXISTS mind_financial_approval (
  user_id text NOT NULL,
  id text NOT NULL,
  operation_id text NOT NULL,
  request_hash text NOT NULL,
  request jsonb NOT NULL,
  ceiling_micros bigint NOT NULL CHECK (ceiling_micros >= 0),
  policy_revision integer NOT NULL,
  state text NOT NULL CHECK (state IN ('pending','approved','consumed','revoked')),
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id,id)
);
CREATE TABLE IF NOT EXISTS mind_verified_free_pricing (
  user_id text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  evidence jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (user_id,provider,model)
);
CREATE TABLE IF NOT EXISTS mind_financial_reconciliation (
  user_id text NOT NULL,
  id text NOT NULL,
  ledger_id text NOT NULL,
  invoice_ref text NOT NULL,
  actual_micros bigint NOT NULL CHECK (actual_micros >= 0),
  previous_micros bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id,id),
  UNIQUE (user_id,ledger_id,invoice_ref)
);
