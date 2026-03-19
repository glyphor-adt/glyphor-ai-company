-- Section A3: Backfill cost from tool_call_traces for runs before A1 instrumentation
UPDATE agent_runs ar
SET total_tool_cost_usd = tct_agg.total_cost,
    total_cost_usd = tct_agg.total_cost,
    cost_source = 'tool_traces_only'
FROM (
  SELECT run_id, SUM(estimated_cost_usd) AS total_cost
  FROM tool_call_traces
  WHERE estimated_cost_usd IS NOT NULL
  GROUP BY run_id
) tct_agg
WHERE ar.id = tct_agg.run_id
AND ar.total_cost_usd IS NULL;
