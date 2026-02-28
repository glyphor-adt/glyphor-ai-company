-- ═══════════════════════════════════════════════════════════════
-- Enhancement 1: Constitutional Agent Governance (CAG)
-- Agent constitutional principles + evaluation results
-- ═══════════════════════════════════════════════════════════════

-- Agent constitutional principles
CREATE TABLE IF NOT EXISTS agent_constitutions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_role TEXT NOT NULL,
  principles JSONB NOT NULL DEFAULT '[]',
  -- Each principle: { id: string, text: string, category: string, weight: number, source: 'system'|'learned'|'human', effectiveness: number, createdAt: string }
  version INT NOT NULL DEFAULT 1,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(agent_role, active)
);

CREATE INDEX IF NOT EXISTS idx_constitutions_lookup
  ON agent_constitutions(agent_role) WHERE active = TRUE;

-- Constitutional evaluation results (per run)
CREATE TABLE IF NOT EXISTS constitutional_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  agent_role TEXT NOT NULL,
  constitution_version INT NOT NULL,
  principle_scores JSONB NOT NULL DEFAULT '[]',
  -- Each score: { principleId: string, score: number (0-1), reasoning: string }
  overall_adherence FLOAT NOT NULL,
  violations TEXT[] DEFAULT '{}',
  revision_triggered BOOLEAN NOT NULL DEFAULT FALSE,
  pre_revision_confidence FLOAT,
  post_revision_confidence FLOAT,
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_const_eval_run ON constitutional_evaluations(run_id);
CREATE INDEX IF NOT EXISTS idx_const_eval_role ON constitutional_evaluations(agent_role, evaluated_at DESC);

-- Enable RLS
ALTER TABLE agent_constitutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE constitutional_evaluations ENABLE ROW LEVEL SECURITY;
