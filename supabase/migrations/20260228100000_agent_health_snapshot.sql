-- Agent health observability view
-- Surfaces: agents behind schedule, stuck assignments, abort rates, budget utilization
-- Used by dashboard and alerting queries.

CREATE OR REPLACE VIEW agent_health_snapshot AS
WITH run_stats_24h AS (
  SELECT
    agent_id,
    COUNT(*) FILTER (WHERE status = 'completed') AS completions_24h,
    COUNT(*) FILTER (WHERE status = 'aborted')   AS aborts_24h,
    COUNT(*) FILTER (WHERE status = 'failed')    AS failures_24h,
    COUNT(*)                                      AS total_runs_24h,
    COALESCE(SUM(cost), 0)                        AS spend_24h,
    MAX(started_at)                                AS last_run_at
  FROM agent_runs
  WHERE started_at > NOW() - INTERVAL '24 hours'
  GROUP BY agent_id
),
stuck_assignments AS (
  SELECT
    assigned_to,
    COUNT(*) AS stuck_count
  FROM work_assignments
  WHERE status = 'dispatched'
    AND created_at < NOW() - INTERVAL '30 minutes'
  GROUP BY assigned_to
),
active_zombies AS (
  SELECT
    agent_id,
    COUNT(*) AS zombie_count
  FROM agent_runs
  WHERE status = 'running'
    AND created_at < NOW() - INTERVAL '5 minutes'
  GROUP BY agent_id
)
SELECT
  ca.role,
  ca.display_name,
  ca.status                                                     AS agent_status,
  rs.last_run_at,
  EXTRACT(EPOCH FROM (NOW() - rs.last_run_at)) / 60             AS minutes_since_last_run,
  COALESCE(rs.completions_24h, 0)                               AS completions_24h,
  COALESCE(rs.aborts_24h, 0)                                    AS aborts_24h,
  COALESCE(rs.failures_24h, 0)                                  AS failures_24h,
  COALESCE(rs.total_runs_24h, 0)                                AS total_runs_24h,
  CASE
    WHEN COALESCE(rs.total_runs_24h, 0) = 0 THEN 0
    ELSE ROUND(rs.aborts_24h::numeric / rs.total_runs_24h * 100, 1)
  END                                                           AS abort_rate_pct,
  COALESCE(rs.spend_24h, 0)                                     AS spend_24h,
  COALESCE(sa.stuck_count, 0)                                   AS stuck_assignments,
  COALESCE(az.zombie_count, 0)                                  AS zombie_runs
FROM company_agents ca
LEFT JOIN run_stats_24h    rs ON rs.agent_id    = ca.role
LEFT JOIN stuck_assignments sa ON sa.assigned_to = ca.role
LEFT JOIN active_zombies    az ON az.agent_id    = ca.role
WHERE ca.status = 'active'
ORDER BY
  az.zombie_count DESC NULLS LAST,
  abort_rate_pct  DESC NULLS LAST,
  minutes_since_last_run DESC NULLS LAST;
