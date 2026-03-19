-- Section C1: Handoff trace table — records quality of inter-agent handoffs
CREATE TABLE IF NOT EXISTS handoff_traces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upstream_agent_id TEXT NOT NULL,
  downstream_agent_id TEXT NOT NULL,
  upstream_run_id UUID REFERENCES agent_runs(id) ON DELETE SET NULL,
  downstream_run_id UUID REFERENCES agent_runs(id) ON DELETE SET NULL,
  upstream_assignment_id UUID REFERENCES work_assignments(id) ON DELETE SET NULL,
  downstream_assignment_id UUID REFERENCES work_assignments(id) ON DELETE SET NULL,
  directive_id UUID,
  handoff_type TEXT,
  upstream_output_quality NUMERIC,
  downstream_input_usability NUMERIC,
  context_loss_detected BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ht_upstream   ON handoff_traces(upstream_agent_id);
CREATE INDEX IF NOT EXISTS idx_ht_downstream ON handoff_traces(downstream_agent_id);
CREATE INDEX IF NOT EXISTS idx_ht_directive  ON handoff_traces(directive_id);

-- Section C4: Handoff health view — aggregated quality per agent pair
CREATE OR REPLACE VIEW agent_handoff_health AS
SELECT
  upstream_agent_id,
  downstream_agent_id,
  COUNT(*) AS handoff_count,
  AVG(upstream_output_quality) AS avg_upstream_quality,
  AVG(downstream_input_usability) AS avg_usability,
  SUM(CASE WHEN context_loss_detected THEN 1 ELSE 0 END) AS context_loss_count,
  ROUND(
    SUM(CASE WHEN context_loss_detected THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*),0) * 100,
    1
  ) AS context_loss_rate_pct
FROM handoff_traces
WHERE downstream_input_usability IS NOT NULL
GROUP BY upstream_agent_id, downstream_agent_id;
