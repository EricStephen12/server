-- Collective Intelligence: anonymized global pattern ledger (no user PII).
CREATE TABLE IF NOT EXISTS collective_patterns (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mode                TEXT NOT NULL,
  niche_key           TEXT NOT NULL,
  hook_band           TEXT NOT NULL,
  retention_band      TEXT NOT NULL,
  conversion_band     TEXT NOT NULL,
  primary_trigger     TEXT,
  style_tags          TEXT[] NOT NULL DEFAULT '{}',
  awareness_level     TEXT,
  market_stage        TEXT,
  pattern_summary     TEXT NOT NULL,
  content_fingerprint TEXT NOT NULL UNIQUE,
  sighting_count      INTEGER NOT NULL DEFAULT 1,
  last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_collective_patterns_niche_mode
  ON collective_patterns (niche_key, mode);
CREATE INDEX IF NOT EXISTS idx_collective_patterns_trigger
  ON collective_patterns (primary_trigger);
CREATE INDEX IF NOT EXISTS idx_collective_patterns_last_seen
  ON collective_patterns (last_seen_at DESC);
