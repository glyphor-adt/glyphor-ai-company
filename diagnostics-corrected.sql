-- ============================================================================
-- GLYPHOR AUTONOMOUS OPERATION DIAGNOSTICS
-- Run against Cloud SQL — snapshot results for before/after comparison
-- Corrected for actual schema: agent_runs.agent_id, work_assignments.assigned_to
-- ============================================================================

-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ 1. ABORT RATE BY AGENT                                                   │
-- │    Target: abort_pct < 5% for all agents                                │
-- └──────────────────────────────────────────────────────────────────────────┘

SELECT
  ar.agent_id,
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE ar.status = 'completed') AS completed,
  COUNT(*) FILTER (WHERE ar.status = 'aborted') AS aborted,
  COUNT(*) FILTER (WHERE ar.status = 'failed') AS failed,
  ROUND(100.0 * COUNT(*) FILTER (WHERE ar.status = 'aborted')
    / NULLIF(COUNT(*), 0), 1) AS abort_pct,
  ROUND(AVG(ar.turns) FILTER (WHERE ar.status = 'aborted'), 1) AS avg_abort_turns,
  ROUND(AVG(ar.input_tokens) FILTER (WHERE ar.status = 'aborted')) AS avg_abort_input_tokens,
  ROUND(AVG(ar.duration_ms) FILTER (WHERE ar.status = 'aborted')) AS avg_abort_duration_ms
FROM agent_runs ar
WHERE ar.created_at > NOW() - INTERVAL '7 days'
GROUP BY ar.agent_id
ORDER BY abort_pct DESC;


-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ 2. TOKEN CONSUMPTION — HEAVIEST AGENTS                                   │
-- └──────────────────────────────────────────────────────────────────────────┘

SELECT
  ar.agent_id, ar.task, ar.turns, ar.input_tokens,
  ar.output_tokens, ar.cost, ar.duration_ms,
  ar.status, ar.error
FROM agent_runs ar
WHERE ar.agent_id IN ('cmo', 'cto', 'chief-of-staff', 'cpo', 'cfo')
AND ar.created_at > NOW() - INTERVAL '3 days'
ORDER BY ar.input_tokens DESC
LIMIT 30;


-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ 3. TURN-1 TOKEN BASELINE                                                │
-- └──────────────────────────────────────────────────────────────────────────┘

SELECT
  ar.agent_id,
  ROUND(AVG(ar.input_tokens) FILTER (WHERE ar.turns = 1), 0) AS avg_turn1_input,
  ROUND(AVG(ar.input_tokens) FILTER (WHERE ar.turns BETWEEN 2 AND 4), 0) AS avg_mid_turn_input,
  ROUND(AVG(ar.input_tokens) FILTER (WHERE ar.turns > 5), 0) AS avg_late_turn_input,
  ROUND(AVG(ar.input_tokens) FILTER (WHERE ar.turns > 5), 0)
    - ROUND(AVG(ar.input_tokens) FILTER (WHERE ar.turns = 1), 0) AS history_growth,
  ROUND(AVG(ar.turns), 1) AS avg_turns,
  COUNT(*) AS sample_size
FROM agent_runs ar
WHERE ar.created_at > NOW() - INTERVAL '7 days'
AND ar.status IN ('completed', 'aborted')
GROUP BY ar.agent_id
HAVING COUNT(*) > 3
ORDER BY avg_turn1_input DESC;


-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ 4. COOLDOWN DEAD TIME                                                    │
-- └──────────────────────────────────────────────────────────────────────────┘

WITH run_gaps AS (
  SELECT
    agent_id, status, created_at,
    LAG(status) OVER (PARTITION BY agent_id ORDER BY created_at) AS prev_status,
    created_at - LAG(created_at) OVER (PARTITION BY agent_id ORDER BY created_at) AS gap
  FROM agent_runs
  WHERE created_at > NOW() - INTERVAL '3 days'
)
SELECT
  agent_id,
  COUNT(*) FILTER (WHERE prev_status = 'aborted') AS post_abort_runs,
  COUNT(*) FILTER (WHERE prev_status = 'aborted' AND gap > INTERVAL '25 minutes') AS long_cooldown_gaps,
  COUNT(*) FILTER (WHERE prev_status = 'aborted' AND gap < INTERVAL '10 minutes') AS fast_recovery_gaps,
  ROUND(AVG(EXTRACT(EPOCH FROM gap) / 60) FILTER (WHERE prev_status = 'aborted'), 1) AS avg_post_abort_gap_min,
  ROUND(MIN(EXTRACT(EPOCH FROM gap) / 60) FILTER (WHERE prev_status = 'aborted'), 1) AS min_post_abort_gap_min,
  ROUND(MAX(EXTRACT(EPOCH FROM gap) / 60) FILTER (WHERE prev_status = 'aborted'), 1) AS max_post_abort_gap_min
FROM run_gaps
GROUP BY agent_id
HAVING COUNT(*) FILTER (WHERE prev_status = 'aborted') > 0
ORDER BY avg_post_abort_gap_min DESC;


-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ 5. SARAH ORCHESTRATION SUCCESS                                           │
-- └──────────────────────────────────────────────────────────────────────────┘

SELECT
  ar.status,
  ar.task,
  ar.turns,
  ar.input_tokens,
  ar.duration_ms,
  ar.error,
  (SELECT COUNT(*) FROM work_assignments wa
   WHERE wa.created_at BETWEEN ar.created_at AND ar.created_at + INTERVAL '5 minutes'
  ) AS assignments_created,
  ar.created_at
FROM agent_runs ar
WHERE ar.agent_id = 'chief-of-staff'
AND ar.task IN ('orchestrate', 'work_loop', 'proactive')
AND ar.created_at > NOW() - INTERVAL '7 days'
ORDER BY ar.created_at DESC
LIMIT 25;


-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ 6. WORK ASSIGNMENT PIPELINE                                              │
-- └──────────────────────────────────────────────────────────────────────────┘

-- 6a: Status summary
SELECT
  wa.status,
  COUNT(*) AS count,
  ROUND(AVG(EXTRACT(EPOCH FROM (COALESCE(wa.updated_at, NOW()) - wa.created_at)) / 3600), 1) AS avg_age_hours,
  MAX(NOW() - wa.created_at) AS oldest
FROM work_assignments wa
WHERE wa.created_at > NOW() - INTERVAL '14 days'
GROUP BY wa.status
ORDER BY count DESC;

-- 6b: Stuck assignments
SELECT
  wa.id, wa.assigned_to, wa.status, wa.directive_id,
  fd.title AS directive,
  NOW() - wa.created_at AS age,
  wa.blocker_reason
FROM work_assignments wa
LEFT JOIN founder_directives fd ON fd.id = wa.directive_id
WHERE wa.status IN ('pending', 'dispatched', 'in_progress')
AND wa.created_at < NOW() - INTERVAL '6 hours'
ORDER BY wa.created_at ASC;


-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ 7. STUCK RUNS (should be 0 if reaper is working)                        │
-- └──────────────────────────────────────────────────────────────────────────┘

SELECT
  ar.id, ar.agent_id, ar.task, ar.status,
  ar.created_at,
  NOW() - ar.created_at AS stuck_duration
FROM agent_runs ar
WHERE ar.status = 'running'
AND ar.created_at < NOW() - INTERVAL '10 minutes'
ORDER BY ar.created_at ASC;


-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ 8. PROACTIVE WORK FREQUENCY                                              │
-- └──────────────────────────────────────────────────────────────────────────┘

SELECT
  ar.agent_id,
  COUNT(*) FILTER (WHERE ar.task = 'proactive') AS proactive_runs,
  COUNT(*) FILTER (WHERE ar.task = 'work_loop') AS work_loop_runs,
  COUNT(*) FILTER (WHERE ar.task IN ('on_demand')) AS on_demand_runs,
  COUNT(*) FILTER (WHERE ar.task NOT IN ('proactive', 'work_loop', 'on_demand')) AS scheduled_runs,
  COUNT(*) AS total_runs,
  ROUND(100.0 * COUNT(*) FILTER (WHERE ar.status = 'completed') / NULLIF(COUNT(*), 0), 1) AS success_pct
FROM agent_runs ar
WHERE ar.created_at > NOW() - INTERVAL '7 days'
GROUP BY ar.agent_id
ORDER BY total_runs DESC;


-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ 9. COST SUMMARY                                                          │
-- └──────────────────────────────────────────────────────────────────────────┘

SELECT
  DATE(ar.created_at) AS day,
  COUNT(*) AS total_runs,
  COUNT(*) FILTER (WHERE ar.status = 'completed') AS completed,
  COUNT(*) FILTER (WHERE ar.status = 'aborted') AS aborted,
  ROUND(SUM(ar.cost)::numeric, 2) AS total_cost,
  ROUND(AVG(ar.cost)::numeric, 4) AS avg_cost_per_run,
  ROUND(SUM(ar.input_tokens)::numeric / 1000000, 2) AS total_input_mtokens,
  ROUND(AVG(ar.input_tokens)::numeric, 0) AS avg_input_tokens
FROM agent_runs ar
WHERE ar.created_at > NOW() - INTERVAL '14 days'
GROUP BY DATE(ar.created_at)
ORDER BY day DESC;
