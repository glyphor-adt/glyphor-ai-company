-- McKinsey-Style Deep Dive table
-- Stores structured research and reports from the DeepDiveEngine

CREATE TABLE IF NOT EXISTS deep_dives (
  id              TEXT PRIMARY KEY,
  target          TEXT NOT NULL,
  context         TEXT,
  status          TEXT NOT NULL DEFAULT 'scoping',
  requested_by    TEXT NOT NULL DEFAULT 'dashboard',
  research_areas  JSONB NOT NULL DEFAULT '[]'::JSONB,
  sources         JSONB NOT NULL DEFAULT '[]'::JSONB,
  report          JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,
  error           TEXT,

  CONSTRAINT deep_dives_status_check CHECK (
    status IN ('scoping', 'researching', 'analyzing', 'synthesizing', 'completed', 'failed')
  )
);

-- Index for listing by recency
CREATE INDEX IF NOT EXISTS idx_deep_dives_created_at ON deep_dives (created_at DESC);

-- RLS
ALTER TABLE deep_dives ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on deep_dives"
  ON deep_dives FOR ALL
  USING (true)
  WITH CHECK (true);
