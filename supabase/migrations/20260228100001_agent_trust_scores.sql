-- ═══════════════════════════════════════════════════════════════
-- Enhancement 2: Dynamic Trust Scoring
-- Per-agent trust scores with domain-specific tracking
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS agent_trust_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_role TEXT NOT NULL UNIQUE,
  trust_score FLOAT NOT NULL DEFAULT 0.5 CHECK (trust_score >= 0 AND trust_score <= 1),
  domain_scores JSONB NOT NULL DEFAULT '{}',
  -- { "financial": 0.8, "technical": 0.6, "communication": 0.7, "research": 0.5 }
  score_history JSONB NOT NULL DEFAULT '[]',
  -- Last 50 entries: [{ score: number, delta: number, reason: string, source: string, timestamp: string }]
  total_runs INT NOT NULL DEFAULT 0,
  successful_runs INT NOT NULL DEFAULT 0,
  human_overrides INT NOT NULL DEFAULT 0,
  formal_failures INT NOT NULL DEFAULT 0,
  last_incident TIMESTAMPTZ,
  auto_promotion_eligible BOOLEAN NOT NULL DEFAULT FALSE,
  suspended BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trust_lookup ON agent_trust_scores(agent_role);
CREATE INDEX IF NOT EXISTS idx_trust_suspended ON agent_trust_scores(agent_role) WHERE suspended = TRUE;

-- Atomic trust update function
CREATE OR REPLACE FUNCTION update_trust_score(
  p_agent_role TEXT,
  p_new_score FLOAT,
  p_domain_scores JSONB,
  p_history_entry JSONB,
  p_max_history INT,
  p_suspended BOOLEAN,
  p_auto_promotion BOOLEAN,
  p_increment_runs BOOLEAN
) RETURNS VOID AS $$
BEGIN
  UPDATE agent_trust_scores SET
    trust_score = p_new_score,
    domain_scores = p_domain_scores,
    score_history = (
      SELECT jsonb_agg(elem)
      FROM (
        SELECT elem FROM jsonb_array_elements(score_history || jsonb_build_array(p_history_entry)) AS elem
        ORDER BY (elem->>'timestamp')::timestamptz DESC
        LIMIT p_max_history
      ) sub
    ),
    total_runs = CASE WHEN p_increment_runs THEN total_runs + 1 ELSE total_runs END,
    suspended = p_suspended,
    auto_promotion_eligible = p_auto_promotion,
    last_incident = CASE WHEN p_new_score < trust_score THEN NOW() ELSE last_incident END,
    updated_at = NOW()
  WHERE agent_role = p_agent_role;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE agent_trust_scores ENABLE ROW LEVEL SECURITY;
