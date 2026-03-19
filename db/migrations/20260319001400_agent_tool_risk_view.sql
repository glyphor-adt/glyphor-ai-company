-- Agent Tool Risk View — cross-references per-agent tool call traces
-- with fleet-wide tool reputation to surface actionable risk signals.
--
-- agent_underperforming_vs_fleet = true means an agent is failing on a tool
-- that other agents use successfully (likely a prompt/context problem,
-- not a tool reliability problem).

CREATE OR REPLACE VIEW agent_tool_risk AS
SELECT
  tct.agent_id,
  tct.tool_name,
  COUNT(*)::int                                               AS call_count,
  AVG(CASE WHEN tct.result_success THEN 1.0 ELSE 0.0 END)   AS agent_success_rate,
  tr.success_rate                                             AS fleet_success_rate,
  tr.avg_latency_ms,
  tr.timeout_rate,
  CASE
    WHEN tr.success_rate < 0.7  THEN 'high'
    WHEN tr.success_rate < 0.85 THEN 'medium'
    ELSE 'low'
  END AS fleet_risk,
  CASE
    WHEN AVG(CASE WHEN tct.result_success THEN 1.0 ELSE 0.0 END) < tr.success_rate - 0.15
    THEN true ELSE false
  END AS agent_underperforming_vs_fleet
FROM tool_call_traces tct
LEFT JOIN tool_reputation tr ON tr.tool_name = tct.tool_name
WHERE tct.called_at > NOW() - INTERVAL '30 days'
GROUP BY tct.agent_id, tct.tool_name, tr.success_rate, tr.avg_latency_ms, tr.timeout_rate;
