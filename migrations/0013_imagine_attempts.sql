CREATE TABLE IF NOT EXISTS mind_imagine_days (
  owner_id text NOT NULL,
  day date NOT NULL,
  PRIMARY KEY (owner_id, day)
);
CREATE TABLE IF NOT EXISTS mind_imagine_attempts (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  day date NOT NULL,
  model text NOT NULL,
  n integer NOT NULL CHECK (n > 0),
  confirmed boolean NOT NULL DEFAULT false,
  at_ms bigint NOT NULL,
  FOREIGN KEY (owner_id, day) REFERENCES mind_imagine_days (owner_id, day)
);
CREATE INDEX IF NOT EXISTS mind_imagine_attempts_owner_day ON mind_imagine_attempts(owner_id, day);
ALTER TABLE mind_imagine_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE mind_imagine_attempts ENABLE ROW LEVEL SECURITY;
