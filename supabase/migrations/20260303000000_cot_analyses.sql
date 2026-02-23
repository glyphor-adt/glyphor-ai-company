-- Chain of Thought analyses table
CREATE TABLE IF NOT EXISTS cot_analyses (
  id TEXT PRIMARY KEY,
  query TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planning' CHECK (status IN ('planning', 'decomposing', 'mapping', 'analyzing', 'validating', 'completed', 'failed')),
  requested_by TEXT NOT NULL,
  report JSONB DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ DEFAULT NULL,
  error TEXT DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_cot_analyses_status ON cot_analyses(status);
CREATE INDEX IF NOT EXISTS idx_cot_analyses_created ON cot_analyses(created_at DESC);
