-- ═══════════════════════════════════════════════════════════════════
-- Migration: Agent Dream Consolidation Infrastructure
-- Date: 2026-04-06
--
-- Creates tables for per-agent dream (background memory) consolidation:
--   1. agent_dream_log — Tracks when each agent last ran dream consolidation
--   2. founder_review_flags — Flags recurring agent issues for human review
--
-- Also adds a `performance_trend` column to agent_world_model for tracking
-- improvement trajectories over time.
-- ═══════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────
-- TABLE: agent_dream_log
-- Tracks dream consolidation runs per agent. Used by the
-- agentDreamConsolidator to avoid re-processing the same runs.
-- ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS agent_dream_log (
  agent_role      TEXT PRIMARY KEY,
  last_dream_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  runs_analyzed   INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE agent_dream_log IS
  'Per-agent dream consolidation tracking. Records last consolidation time and cumulative runs analyzed.';

-- ───────────────────────────────────────────────────────────────────
-- TABLE: founder_review_flags
-- When dream consolidation detects recurring failure patterns for an
-- agent, it flags them here for Kristina/Andrew to review.
-- ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS founder_review_flags (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_role      TEXT NOT NULL,
  category        TEXT NOT NULL CHECK (category IN (
    'recurring_failure', 'performance_decline', 'tool_misuse',
    'cost_anomaly', 'capability_gap', 'other'
  )),
  description     TEXT NOT NULL,
  suggested_fix   TEXT,
  severity        TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved', 'dismissed')),
  resolved_by     TEXT,
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_founder_review_flags_role ON founder_review_flags(agent_role);
CREATE INDEX IF NOT EXISTS idx_founder_review_flags_status ON founder_review_flags(status);
CREATE INDEX IF NOT EXISTS idx_founder_review_flags_created ON founder_review_flags(created_at DESC);

COMMENT ON TABLE founder_review_flags IS
  'Flags raised by dream consolidation for founder review. Recurring failures, performance declines, and capability gaps.';

-- ───────────────────────────────────────────────────────────────────
-- ALTER: agent_world_model — Add performance_trend column
-- Tracks whether an agent is improving, stable, or declining based
-- on cross-session dream analysis.
-- ───────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'agent_world_model' AND column_name = 'performance_trend'
  ) THEN
    ALTER TABLE agent_world_model ADD COLUMN performance_trend TEXT DEFAULT 'stable'
      CHECK (performance_trend IN ('improving', 'stable', 'declining'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'agent_world_model' AND column_name = 'last_dream_at'
  ) THEN
    ALTER TABLE agent_world_model ADD COLUMN last_dream_at TIMESTAMPTZ;
  END IF;
END $$;

COMMENT ON COLUMN agent_world_model.performance_trend IS
  'Overall trend from dream consolidation: improving / stable / declining';
COMMENT ON COLUMN agent_world_model.last_dream_at IS
  'Last time dream consolidation updated this world model';
