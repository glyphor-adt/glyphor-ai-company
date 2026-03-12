-- Phase 6: Cascade Analysis prediction journal + accuracy tracking
-- Note: simulations.id is TEXT in the live schema, so the FK follows that
-- shape rather than the UUID shown in the roadmap prose.

CREATE TABLE IF NOT EXISTS cascade_predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  simulation_id TEXT NOT NULL REFERENCES simulations(id) ON DELETE CASCADE,
  prediction_type TEXT NOT NULL CHECK (prediction_type IN ('metric_change', 'risk_event', 'team_impact')),
  predicted_value JSONB NOT NULL,
  actual_value JSONB,
  accuracy_score NUMERIC(3,2),
  outcome_observed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cascade_predictions_simulation
  ON cascade_predictions(simulation_id);

CREATE INDEX IF NOT EXISTS idx_cascade_predictions_observed
  ON cascade_predictions(outcome_observed_at, created_at DESC);
