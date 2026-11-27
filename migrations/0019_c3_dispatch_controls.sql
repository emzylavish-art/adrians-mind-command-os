CREATE TABLE IF NOT EXISTS mind_dispatch_policy (
  user_id text PRIMARY KEY,
  paused boolean NOT NULL DEFAULT false,
  daily_limit integer NOT NULL DEFAULT 1000 CHECK (daily_limit BETWEEN 0 AND 10000),
  revision integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mind_dispatch_bucket (
  user_id text NOT NULL,
  bucket text NOT NULL,
  used integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, bucket)
);
