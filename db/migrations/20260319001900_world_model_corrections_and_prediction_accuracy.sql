-- Section B1: World model corrections table — external eval corrections separate from self-assessment
CREATE TABLE IF NOT EXISTS agent_world_model_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL,
  correction_type TEXT NOT NULL CHECK (
    correction_type IN ('weakness_added', 'strength_revised', 'prediction_accuracy_updated')
  ),
  field_name TEXT NOT NULL,
  previous_value JSONB,
  corrected_value JSONB,
  evidence_run_id UUID REFERENCES agent_runs(id) ON DELETE SET NULL,
  evidence_eval_score NUMERIC,
  source TEXT NOT NULL DEFAULT 'reflection_agent',
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_awmc_agent_id ON agent_world_model_corrections(agent_id);

-- Section B3: Prediction accuracy view — real accuracy from external evals, not self-assessment
CREATE OR REPLACE VIEW agent_prediction_accuracy AS
SELECT
  wa.assigned_by AS agent_id,
  COUNT(*) AS total_predictions,
  AVG(CASE
    WHEN wa.quality_score >= 70
    AND ae.score_normalized >= 0.70
    THEN 1.0
    WHEN wa.quality_score < 70
    AND ae.score_normalized < 0.70
    THEN 1.0
    ELSE 0.0
  END) AS prediction_accuracy,
  AVG(wa.quality_score / 100.0) AS avg_self_score,
  AVG(ae.score_normalized) AS avg_external_score,
  AVG(wa.quality_score / 100.0) - AVG(ae.score_normalized) AS calibration_bias
FROM work_assignments wa
JOIN assignment_evaluations ae ON ae.assignment_id = wa.id
  AND ae.evaluator_type IN ('executive', 'team')
WHERE wa.assigned_by IS NOT NULL
GROUP BY wa.assigned_by;
