-- ═══════════════════════════════════════════════════════════════
-- Enhancement 3: Provenance Decision Chains
-- Full audit trail for every directive → outcome path
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS decision_chains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  directive_id UUID REFERENCES founder_directives(id),
  trigger_type TEXT NOT NULL DEFAULT 'directive',
  -- 'directive' | 'scheduled' | 'event_triggered' | 'manual'
  chain JSONB NOT NULL DEFAULT '[]',
  -- Ordered array of chain links. Each link:
  -- { type: string, timestamp: string, agentRole?: string, ...type-specific fields }
  contribution_scores JSONB DEFAULT '{}',
  -- Per-agent contribution: { "ceo": 0.3, "cto": 0.5, "analyst": 0.2 }
  total_cost_usd NUMERIC(10,6) DEFAULT 0,
  total_duration_ms INT DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  -- 'active' | 'completed' | 'failed' | 'abandoned'
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chains_directive ON decision_chains(directive_id) WHERE directive_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chains_status ON decision_chains(status, created_at DESC);

-- Append chain links atomically
CREATE OR REPLACE FUNCTION append_chain_links(
  p_chain_id UUID,
  p_links JSONB
) RETURNS VOID AS $$
BEGIN
  UPDATE decision_chains
  SET chain = chain || p_links
  WHERE id = p_chain_id;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE decision_chains ENABLE ROW LEVEL SECURITY;
