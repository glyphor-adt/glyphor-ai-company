-- ═══════════════════════════════════════════════════════════════
-- Knowledge graph repairs
-- Align causal edge schema with runtime code
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE kg_edges ADD COLUMN IF NOT EXISTS causal_mechanism TEXT;

CREATE INDEX IF NOT EXISTS idx_kg_edges_causal_confidence
  ON kg_edges(causal_confidence)
  WHERE causal_confidence IS NOT NULL;