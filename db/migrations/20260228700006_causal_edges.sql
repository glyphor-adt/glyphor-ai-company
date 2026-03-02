-- ═══════════════════════════════════════════════════════════════
-- Enhancement 5: Counterfactual Causal Reasoning
-- Add causal metadata columns to kg_edges
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE kg_edges ADD COLUMN IF NOT EXISTS causal_confidence FLOAT;
ALTER TABLE kg_edges ADD COLUMN IF NOT EXISTS causal_lag_days INT;
ALTER TABLE kg_edges ADD COLUMN IF NOT EXISTS causal_magnitude FLOAT;
-- magnitude: -10 to +10, negative = inverse relationship
ALTER TABLE kg_edges ADD COLUMN IF NOT EXISTS causal_evidence TEXT[] DEFAULT '{}';
ALTER TABLE kg_edges ADD COLUMN IF NOT EXISTS last_validated TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_kg_causal ON kg_edges(edge_type, causal_confidence)
  WHERE edge_type = 'CAUSES' AND causal_confidence IS NOT NULL;

-- Also add significance_score to shared_episodes for episodic replay (Enhancement 7)
ALTER TABLE shared_episodes ADD COLUMN IF NOT EXISTS significance_score FLOAT;
