-- Query A: Is the heartbeat cron actually firing?
\echo '========== QUERY A: Heartbeat cron firing? =========='
SELECT
  started_at,
  status,
  turns,
  LEFT(output, 300) as output_preview,
  LEFT(error, 300) as error_preview
FROM agent_runs
WHERE task = 'heartbeat'
  AND started_at > NOW() - INTERVAL '24 hours'
ORDER BY started_at DESC
LIMIT 20;

-- Query B: Are there ANY work_loop runs, ever?
\echo '========== QUERY B: Any work_loop runs ever? =========='
SELECT
  agent_id,
  started_at,
  status,
  LEFT(output, 200) as output_preview
FROM agent_runs
WHERE task = 'work_loop'
ORDER BY started_at DESC
LIMIT 10;

-- Query C: Is there a cron entry for heartbeat?
\echo '========== QUERY C: Agent schedules for heartbeat/work_loop =========='
SELECT *
FROM agent_schedules
WHERE task ILIKE '%heartbeat%'
   OR task ILIKE '%work_loop%';

\echo '========== QUERY C2: Data sync status for heartbeat =========='
SELECT id, status, last_success_at, last_failure_at, last_error, consecutive_failures
FROM data_sync_status
WHERE id ILIKE '%heartbeat%';

-- Query D: Check for abort cooldown traps
\echo '========== QUERY D: Abort cooldown traps =========='
SELECT
  agent_id,
  MAX(started_at) as last_aborted,
  COUNT(*) as abort_count,
  NOW() - MAX(started_at) as time_since_last_abort
FROM agent_runs
WHERE status = 'aborted'
  AND started_at > NOW() - INTERVAL '24 hours'
GROUP BY agent_id
ORDER BY last_aborted DESC;

-- Query E: Are events being processed?
\echo '========== QUERY E: Event processing check =========='
SELECT
  type,
  source,
  processed_by,
  timestamp
FROM events
WHERE type IN ('assignment.submitted', 'assignment.blocked', 'message.sent', 'alert.triggered')
  AND timestamp > NOW() - INTERVAL '24 hours'
ORDER BY timestamp DESC
LIMIT 20;

-- Query F: Sarah's actual orchestration tool calls
\echo '========== QUERY F: Sarah dispatch vs plan =========='
SELECT
  started_at,
  status,
  turns,
  cost,
  LEFT(output, 800) as full_output
FROM agent_runs
WHERE agent_id = 'chief-of-staff'
  AND task IN ('orchestrate', 'cos-orchestrate', 'on_demand')
  AND started_at > NOW() - INTERVAL '24 hours'
  AND status = 'completed'
  AND turns > 0
ORDER BY started_at DESC
LIMIT 5;
