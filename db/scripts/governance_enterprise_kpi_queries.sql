-- ============================================================================
-- Governance / enterprise KPI checklist — ad-hoc queries against Postgres
-- ============================================================================
-- Run in psql, Metabase, Cloud SQL Studio, or CI after setting variables below.
--
--   \set window_days 30
--   \set tenant_id '00000000-0000-0000-0000-000000000000'
--
-- For one-off use, replace :window_days (psql) or use literal 30 in INTERVAL math.
-- Default tenant for eval tables (matches migrations):
--   '00000000-0000-0000-0000-000000000000'::uuid
-- RLS: connect as a role that can read tenant-scoped tables, or use glyphor_system.
--
-- NOTE: If migration order created two different `decision_traces` shapes, adjust
-- section 4 to match your live information_schema.columns for public.decision_traces.
-- ============================================================================

-- ── 1) Unprompted proactivity — schedules & cadence ─────────────────────────
--    KPI: enabled crons, stale triggers, workload mix (scheduled vs other tasks)

SELECT
  COUNT(*) FILTER (WHERE enabled) AS enabled_schedule_rows,
  COUNT(*) FILTER (WHERE NOT enabled) AS disabled_schedule_rows,
  MAX(last_triggered_at) AS last_any_trigger_at
FROM agent_schedules;

SELECT agent_id, cron_expression, task, enabled, last_triggered_at,
       NOW() - last_triggered_at AS age_since_last_trigger
FROM agent_schedules
WHERE enabled
ORDER BY last_triggered_at NULLS FIRST;

SELECT task,
       COUNT(*) AS runs,
       COUNT(*) FILTER (WHERE status = 'completed') AS completed
FROM agent_runs
WHERE started_at >= NOW() - (:window_days::int * INTERVAL '1 day')
GROUP BY task
ORDER BY runs DESC;

-- Optional: payload JSON on schedules (if column exists) — classify trigger source
SELECT agent_id, task,
       payload->>'source' AS payload_source,
       payload->>'kind' AS payload_kind
FROM agent_schedules
WHERE payload IS NOT NULL AND payload <> '{}'::jsonb
LIMIT 50;


-- ── 2) Bounded autonomy — commitment registry & approval latency ───────────

SELECT status,
       COUNT(*) AS n,
       AVG(EXTRACT(EPOCH FROM (approved_at - created_at))) FILTER (WHERE approved_at IS NOT NULL) AS avg_seconds_to_approve,
       AVG(EXTRACT(EPOCH FROM (executed_at - approved_at))) FILTER (WHERE executed_at IS NOT NULL AND approved_at IS NOT NULL) AS avg_seconds_approve_to_execute
FROM commitment_registry
WHERE created_at >= NOW() - (:window_days::int * INTERVAL '1 day')
GROUP BY status
ORDER BY n DESC;

SELECT COUNT(*) AS pending_human_approval
FROM commitment_registry
WHERE status = 'pending_approval';

SELECT agent_id, auto_approved, COUNT(*) AS n
FROM commitment_registry
WHERE created_at >= NOW() - (:window_days::int * INTERVAL '1 day')
GROUP BY agent_id, auto_approved
ORDER BY n DESC;


-- ── 3) Kill switch — circuit breaker (system_config) ────────────────────────
--    Keys: packages/agent-runtime/src/circuitBreaker.ts

SELECT key, value, updated_at, updated_by
FROM system_config
WHERE key LIKE 'circuit_breaker_%'
ORDER BY key;

SELECT
  (SELECT value FROM system_config WHERE key = 'circuit_breaker_halt_active') AS halt_active,
  (SELECT value FROM system_config WHERE key = 'circuit_breaker_halt_level') AS halt_level,
  (SELECT value::timestamptz FROM system_config WHERE key = 'circuit_breaker_halt_triggered_at') AS halted_at,
  (SELECT value FROM system_config WHERE key = 'circuit_breaker_halt_expires_at') AS expires_at_raw;


-- ── 4) Immutable decision traces — run ledger, manifests, decision_traces ──
--    agent_run_events: payload_digest / event_digest chain per migration
--    agent_runs: plan_manifest, context_manifest (when populated)

SELECT
  COUNT(*) AS events_total,
  COUNT(DISTINCT run_id) AS runs_with_events
FROM agent_run_events
WHERE created_at >= NOW() - (:window_days::int * INTERVAL '1 day');

SELECT event_type, COUNT(*) AS n
FROM agent_run_events
WHERE created_at >= NOW() - (:window_days::int * INTERVAL '1 day')
GROUP BY event_type
ORDER BY n DESC
LIMIT 40;

SELECT
  COUNT(*) AS runs,
  COUNT(*) FILTER (WHERE plan_manifest IS NOT NULL) AS with_plan_manifest,
  COUNT(*) FILTER (WHERE context_manifest IS NOT NULL) AS with_context_manifest,
  COUNT(*) FILTER (WHERE completion_gate_passed IS NOT NULL) AS gate_result_recorded
FROM agent_runs
WHERE started_at >= NOW() - (:window_days::int * INTERVAL '1 day');

SELECT COUNT(*) AS decision_trace_rows
FROM decision_traces
WHERE created_at >= NOW() - (:window_days::int * INTERVAL '1 day');


-- ── 5) Workspace identity — Microsoft / audit (when migrations applied) ─────
--    See migration 20260407210000_microsoft_write_audit_view.sql for view name

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND (table_name ILIKE '%microsoft%' OR table_name ILIKE '%m365%')
ORDER BY table_name;

-- activity_log: agent actions (column names from create_tables migration)
SELECT agent_role, action, COUNT(*) AS n
FROM activity_log
WHERE created_at >= NOW() - (:window_days::int * INTERVAL '1 day')
GROUP BY agent_role, action
ORDER BY n DESC
LIMIT 30;


-- ── 6) Temporal context — world model freshness & knowledge contradictions ─

SELECT agent_role, updated_at,
       NOW() - updated_at AS age
FROM agent_world_model
ORDER BY updated_at ASC NULLS LAST;

SELECT status, COUNT(*) AS n
FROM kg_contradictions
GROUP BY status;

SELECT COUNT(*) AS unresolved_contradictions
FROM kg_contradictions
WHERE status = 'detected';


-- ── 7) Zero-context handoffs — structured contracts ───────────────────────────

SELECT status, escalation_policy, COUNT(*) AS n
FROM agent_handoff_contracts
WHERE issued_at >= NOW() - (:window_days::int * INTERVAL '1 day')
GROUP BY status, escalation_policy
ORDER BY n DESC;

SELECT COUNT(*) FILTER (WHERE status = 'escalated') AS escalated,
       COUNT(*) FILTER (WHERE sla_breached_at IS NOT NULL) AS sla_breached
FROM agent_handoff_contracts
WHERE issued_at >= NOW() - (:window_days::int * INTERVAL '1 day');

SELECT COUNT(*) AS audit_log_entries
FROM agent_handoff_contract_audit_log
WHERE created_at >= NOW() - (:window_days::int * INTERVAL '1 day');


-- ── 8) Cross-department coordination — Chief of Staff activity proxy ────────

SELECT COUNT(*) AS cos_runs,
       COUNT(*) FILTER (WHERE status = 'completed') AS cos_completed,
       COUNT(*) FILTER (WHERE status = 'failed' OR error IS NOT NULL) AS cos_failed_or_error
FROM agent_runs
WHERE agent_id = 'chief-of-staff'
  AND started_at >= NOW() - (:window_days::int * INTERVAL '1 day');

-- work_assignments: directive → agent tasks (founder orchestration)
SELECT assigned_to, status, COUNT(*) AS n
FROM work_assignments
WHERE created_at >= NOW() - (:window_days::int * INTERVAL '1 day')
GROUP BY assigned_to, status
ORDER BY n DESC
LIMIT 40;


-- ── 9) Resilient execution — completion gate & auto-repair (event stream) ─

WITH run_flags AS (
  SELECT
    e.run_id,
    BOOL_OR(e.event_type = 'planning_phase_started') AS has_planning,
    BOOL_OR(e.event_type = 'completion_gate_passed') AS has_pass,
    BOOL_OR(e.event_type = 'completion_gate_failed') AS has_fail,
    BOOL_OR(e.event_type = 'completion_gate_auto_repair_triggered') AS had_auto_repair
  FROM agent_run_events e
  WHERE e.created_at >= NOW() - (:window_days::int * INTERVAL '1 day')
    AND e.event_type IN (
      'planning_phase_started',
      'completion_gate_failed',
      'completion_gate_passed',
      'completion_gate_auto_repair_triggered'
    )
  GROUP BY e.run_id
)
SELECT
  COUNT(*) AS runs_with_gate_signals,
  COUNT(*) FILTER (WHERE has_pass) AS runs_with_gate_pass,
  COUNT(*) FILTER (WHERE had_auto_repair) AS runs_with_auto_repair_triggered
FROM run_flags;


-- ── 10) Cross-model consensus & golden evals ───────────────────────────────
--     Golden: scenario_name ILIKE 'golden:%' (see planningQualitySignals.ts)

SELECT
  COUNT(*) AS golden_results,
  COUNT(*) FILTER (WHERE r.score = 'PASS') AS golden_pass,
  ROUND(100.0 * COUNT(*) FILTER (WHERE r.score = 'PASS') / NULLIF(COUNT(*), 0), 2) AS golden_pass_pct
FROM agent_eval_results r
JOIN agent_eval_scenarios s ON s.id = r.scenario_id
WHERE r.run_date >= NOW() - (:window_days::int * INTERVAL '1 day')
  AND s.scenario_name ILIKE 'golden:%'
  AND r.tenant_id = '00000000-0000-0000-0000-000000000000'::uuid;

SELECT r.agent_role,
       COUNT(*) AS n,
       COUNT(*) FILTER (WHERE r.score = 'PASS') AS passed
FROM agent_eval_results r
JOIN agent_eval_scenarios s ON s.id = r.scenario_id
WHERE r.run_date >= NOW() - (:window_days::int * INTERVAL '1 day')
  AND s.scenario_name ILIKE 'golden:%'
  AND r.tenant_id = '00000000-0000-0000-0000-000000000000'::uuid
GROUP BY r.agent_role
ORDER BY n DESC;

-- Reasoning / routing signals on runs (multi-pass / model routing)
SELECT
  COUNT(*) FILTER (WHERE reasoning_passes > 1) AS multi_pass_runs,
  COUNT(*) FILTER (WHERE routing_model IS NOT NULL) AS runs_with_routing_model
FROM agent_runs
WHERE started_at >= NOW() - (:window_days::int * INTERVAL '1 day');
