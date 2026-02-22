-- Analyses table (Strategic Analysis Engine / "McKinsey analysis")
CREATE TABLE IF NOT EXISTS analyses (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('market_opportunity', 'competitive_landscape', 'product_strategy', 'growth_diagnostic', 'risk_assessment')),
  query TEXT NOT NULL,
  depth TEXT NOT NULL DEFAULT 'standard' CHECK (depth IN ('quick', 'standard', 'deep')),
  status TEXT NOT NULL DEFAULT 'planning' CHECK (status IN ('planning', 'spawning', 'executing', 'synthesizing', 'completed', 'failed')),
  requested_by TEXT NOT NULL,
  threads JSONB DEFAULT '[]'::jsonb,
  report JSONB DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ DEFAULT NULL,
  error TEXT DEFAULT NULL
);

CREATE INDEX idx_analyses_status ON analyses(status);
CREATE INDEX idx_analyses_created ON analyses(created_at DESC);

-- Simulations table (T+1 Simulation Engine)
CREATE TABLE IF NOT EXISTS simulations (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  perspective TEXT NOT NULL DEFAULT 'neutral' CHECK (perspective IN ('optimistic', 'neutral', 'pessimistic')),
  status TEXT NOT NULL DEFAULT 'planning' CHECK (status IN ('planning', 'spawning', 'executing', 'cascading', 'synthesizing', 'completed', 'failed', 'accepted', 'rejected')),
  requested_by TEXT NOT NULL,
  dimensions JSONB DEFAULT '[]'::jsonb,
  report JSONB DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ DEFAULT NULL,
  accepted_at TIMESTAMPTZ DEFAULT NULL,
  accepted_by TEXT DEFAULT NULL,
  error TEXT DEFAULT NULL
);

CREATE INDEX idx_simulations_status ON simulations(status);
CREATE INDEX idx_simulations_created ON simulations(created_at DESC);
