-- Deep Dive Pipeline Expansion — Framework Analysis Tables
-- Sprint 1: Framework agents + convergence synthesis storage

-- ──────────────────────────────────────────────
-- 1. Framework analyses for deep dives
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS deep_dive_frameworks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deep_dive_id    TEXT NOT NULL REFERENCES deep_dives(id) ON DELETE CASCADE,
  framework       TEXT NOT NULL,  -- ansoff, bcg, swot, blue_ocean, porters, pestle
  analysis        JSONB NOT NULL,
  confidence_score NUMERIC(3,2),
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_deep_dive_frameworks_dive_id ON deep_dive_frameworks(deep_dive_id);
CREATE INDEX idx_deep_dive_frameworks_framework ON deep_dive_frameworks(framework);

ALTER TABLE deep_dive_frameworks ENABLE ROW LEVEL SECURITY;

-- ──────────────────────────────────────────────
-- 2. Framework convergence narrative on deep_dives
-- ──────────────────────────────────────────────
ALTER TABLE deep_dives
  ADD COLUMN IF NOT EXISTS framework_convergence TEXT,
  ADD COLUMN IF NOT EXISTS framework_outputs     JSONB DEFAULT '{}';

-- ──────────────────────────────────────────────
-- 3. Framework outputs + convergence on strategy_analyses
-- ──────────────────────────────────────────────
ALTER TABLE strategy_analyses
  ADD COLUMN IF NOT EXISTS framework_outputs     JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS framework_convergence TEXT,
  ADD COLUMN IF NOT EXISTS framework_progress    JSONB DEFAULT '[]';

-- ──────────────────────────────────────────────
-- 4. Monitoring watchlist (Sprint 4 placeholder)
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS deep_dive_watchlist (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deep_dive_id    TEXT NOT NULL REFERENCES deep_dives(id) ON DELETE CASCADE,
  item            TEXT NOT NULL,
  category        TEXT NOT NULL,  -- risk, catalyst, transaction, leadership, regulatory
  trigger_signals JSONB DEFAULT '[]',
  current_status  TEXT,
  priority        TEXT DEFAULT 'medium',
  last_checked    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_deep_dive_watchlist_dive_id ON deep_dive_watchlist(deep_dive_id);

ALTER TABLE deep_dive_watchlist ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS strategy_analysis_watchlist (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id       TEXT NOT NULL REFERENCES strategy_analyses(id) ON DELETE CASCADE,
  item              TEXT NOT NULL,
  category          TEXT NOT NULL,
  trigger_signals   JSONB DEFAULT '[]',
  current_status    TEXT,
  priority          TEXT DEFAULT 'medium',
  last_checked      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_strategy_analysis_watchlist_analysis_id ON strategy_analysis_watchlist(analysis_id);

ALTER TABLE strategy_analysis_watchlist ENABLE ROW LEVEL SECURITY;
