-- ═══════════════════════════════════════════════════════════════
-- Reasoning Engine — Schema & Functions
-- ═══════════════════════════════════════════════════════════════

-- Ensure vector type is available (pgvector lives in extensions schema on Supabase)
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- Per-agent reasoning configuration (overrides default reasoning behavior)
CREATE TABLE IF NOT EXISTS agent_reasoning_config (
  agent_role   TEXT PRIMARY KEY REFERENCES company_agents(role),
  enabled      BOOLEAN   NOT NULL DEFAULT true,
  pass_types   TEXT[]    NOT NULL DEFAULT '{self_critique,consistency_check}',
  min_confidence     FLOAT NOT NULL DEFAULT 0.7,
  max_reasoning_budget FLOAT NOT NULL DEFAULT 0.02,
  cross_model_enabled  BOOLEAN NOT NULL DEFAULT false,
  value_gate_enabled   BOOLEAN NOT NULL DEFAULT false,
  verification_models  TEXT[] NOT NULL DEFAULT '{gemini-2.5-flash-lite}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Reasoning pass results — one row per verification pass per run
CREATE TABLE IF NOT EXISTS reasoning_passes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id       UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  pass_type    TEXT NOT NULL,
  pass_number  INT  NOT NULL,
  model        TEXT NOT NULL,
  confidence   FLOAT NOT NULL,
  issues       JSONB NOT NULL DEFAULT '[]',
  suggestions  JSONB NOT NULL DEFAULT '[]',
  reasoning    TEXT,
  duration_ms  INT,
  cost_usd     FLOAT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reasoning_passes_run_id ON reasoning_passes(run_id);

-- Value assessments — pre-loop value gate decisions
CREATE TABLE IF NOT EXISTS value_assessments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id         UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  score          FLOAT NOT NULL,
  reasoning      TEXT,
  recommendation TEXT NOT NULL,
  alternatives   JSONB,
  cost_usd       FLOAT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_value_assessments_run_id ON value_assessments(run_id);

-- Add reasoning metadata columns to agent_runs
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS reasoning_passes   INT;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS reasoning_confidence FLOAT;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS reasoning_revised   BOOLEAN;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS reasoning_cost_usd  FLOAT;

-- ═══════════════════════════════════════════════════════════════
-- Semantic match functions for JIT context retrieval
-- ═══════════════════════════════════════════════════════════════

-- Match shared episodes by embedding similarity
CREATE OR REPLACE FUNCTION match_shared_episodes(
  query_embedding  vector(768),
  match_count      INT DEFAULT 5,
  match_threshold  FLOAT DEFAULT 0.7,
  filter_domains   TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  id          UUID,
  summary     TEXT,
  detail      JSONB,
  outcome     TEXT,
  confidence  FLOAT,
  domains     TEXT[],
  similarity  FLOAT
)
LANGUAGE plpgsql STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    se.id,
    se.summary,
    se.detail,
    se.outcome,
    se.confidence,
    se.domains,
    1 - (se.embedding <=> query_embedding) AS similarity
  FROM shared_episodes se
  WHERE se.embedding IS NOT NULL
    AND 1 - (se.embedding <=> query_embedding) >= match_threshold
    AND (filter_domains IS NULL OR se.domains && filter_domains)
  ORDER BY se.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Match company knowledge entries by embedding similarity
CREATE OR REPLACE FUNCTION match_company_knowledge(
  query_embedding  vector(768),
  match_count      INT DEFAULT 5,
  match_threshold  FLOAT DEFAULT 0.7
)
RETURNS TABLE (
  id          UUID,
  title       TEXT,
  content     TEXT,
  section     TEXT,
  similarity  FLOAT
)
LANGUAGE plpgsql STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ck.id,
    ck.title,
    ck.content,
    ck.section,
    1 - (ck.embedding <=> query_embedding) AS similarity
  FROM company_knowledge_base ck
  WHERE ck.embedding IS NOT NULL
    AND ck.is_active = true
    AND 1 - (ck.embedding <=> query_embedding) >= match_threshold
  ORDER BY ck.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- Seed default reasoning configs for orchestrator roles
-- ═══════════════════════════════════════════════════════════════

INSERT INTO agent_reasoning_config (agent_role, enabled, pass_types, min_confidence, max_reasoning_budget, cross_model_enabled, value_gate_enabled, verification_models)
VALUES
  ('chief-of-staff', true, '{self_critique,consistency_check,goal_alignment}', 0.7, 0.03, false, true, '{gemini-2.5-flash-lite}'),
  ('cto',            true, '{self_critique,factual_verification}',            0.7, 0.02, false, false, '{gemini-2.5-flash-lite}'),
  ('clo',            true, '{self_critique,consistency_check,factual_verification}', 0.8, 0.02, true, false, '{gemini-2.5-flash-lite,gpt-4.1-mini}'),
  ('vp-research',    true, '{self_critique,factual_verification,cross_model}', 0.75, 0.03, true, false, '{gemini-2.5-flash-lite,gpt-4.1-mini}'),
  ('ops',            true, '{self_critique,consistency_check}',               0.7, 0.02, false, false, '{gemini-2.5-flash-lite}')
ON CONFLICT (agent_role) DO NOTHING;
