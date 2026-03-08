-- Query 1: Agent execution reality check
\echo '========== QUERY 1: Agent execution reality check =========='
SELECT
  agent_id,
  task,
  status,
  COUNT(*) as runs,
  MAX(started_at) as last_run,
  ROUND(AVG(duration_ms / 1000.0)::numeric, 1) as avg_seconds,
  ROUND(AVG(cost)::numeric, 4) as avg_cost
FROM agent_runs
WHERE started_at > NOW() - INTERVAL '72 hours'
GROUP BY agent_id, task, status
ORDER BY agent_id, runs DESC;

-- Query 2: Work assignments pipeline
\echo '========== QUERY 2: Work assignments pipeline =========='
SELECT
  wa.status,
  wa.assigned_to,
  wa.priority,
  LEFT(wa.task_description, 120) as task_preview,
  fd.title as directive_title,
  fd.status as directive_status,
  wa.created_at,
  wa.updated_at,
  LEFT(wa.evaluation, 200) as eval_preview
FROM work_assignments wa
JOIN founder_directives fd ON fd.id = wa.directive_id
WHERE wa.created_at > NOW() - INTERVAL '7 days'
ORDER BY wa.status, wa.created_at DESC
LIMIT 50;

-- Query 3: Sarah's orchestration cycles
\echo '========== QUERY 3: Sarah orchestration cycles =========='
SELECT
  started_at, task, status, turns, cost,
  LEFT(output, 500) as output_preview
FROM agent_runs
WHERE agent_id = 'chief-of-staff'
  AND started_at > NOW() - INTERVAL '48 hours'
ORDER BY started_at DESC
LIMIT 15;

-- Query 4: Heartbeat / work loop decisions
\echo '========== QUERY 4: Agent wake queue =========='
SELECT
  agent_role,
  task,
  reason,
  status,
  created_at,
  dispatched_at
FROM agent_wake_queue
WHERE created_at > NOW() - INTERVAL '48 hours'
ORDER BY created_at DESC
LIMIT 30;

-- Query 5: Inter-agent messages
\echo '========== QUERY 5: Inter-agent messages =========='
SELECT
  from_agent,
  to_agent,
  priority,
  status,
  LEFT(message, 150) as msg_preview,
  created_at,
  responded_at
FROM agent_messages
WHERE created_at > NOW() - INTERVAL '72 hours'
ORDER BY created_at DESC
LIMIT 30;

-- Query 6: Proactive work check
\echo '========== QUERY 6: Proactive work check =========='
SELECT
  agent_id,
  started_at,
  status,
  turns,
  LEFT(output, 300) as output_preview
FROM agent_runs
WHERE task = 'proactive'
  AND started_at > NOW() - INTERVAL '7 days'
ORDER BY started_at DESC
LIMIT 20;

-- Query 7: Events bus
\echo '========== QUERY 7: Events bus =========='
SELECT
  type,
  source,
  priority,
  COUNT(*) as event_count,
  MAX(timestamp) as last_fired
FROM events
WHERE timestamp > NOW() - INTERVAL '48 hours'
GROUP BY type, source, priority
ORDER BY event_count DESC
LIMIT 30;

-- Query 8: Pending directives
\echo '========== QUERY 8: Pending directives =========='
SELECT
  fd.id,
  fd.title,
  fd.status,
  fd.priority,
  fd.created_at,
  COUNT(wa.id) as assignment_count,
  COUNT(wa.id) FILTER (WHERE wa.status = 'completed') as completed,
  COUNT(wa.id) FILTER (WHERE wa.status IN ('pending', 'dispatched', 'in_progress')) as active,
  COUNT(wa.id) FILTER (WHERE wa.status = 'blocked') as blocked
FROM founder_directives fd
LEFT JOIN work_assignments wa ON wa.directive_id = fd.id
WHERE fd.status = 'active'
GROUP BY fd.id
ORDER BY fd.created_at DESC;
