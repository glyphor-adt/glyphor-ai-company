-- Remove deprecated customer-success role artifacts from operational and telemetry tables.
-- These roles are no longer part of the active org model.

DO $$
DECLARE
  legacy_roles text[] := ARRAY[
    'vp-customer-success',
    'onboarding-specialist',
    'support-triage'
  ];
  rec record;
BEGIN
  FOR rec IN
    SELECT *
    FROM (
      VALUES
        ('company_agents', 'role'),
        ('agent_profiles', 'agent_id'),
        ('agent_briefs', 'agent_id'),
        ('agent_schedules', 'agent_id'),
        ('agent_skills', 'agent_role'),
        ('agent_reasoning_config', 'agent_role'),
        ('agent_run_status', 'agent_role'),
        ('agent_trust_scores', 'agent_role'),
        ('agent_wake_queue', 'agent_role'),
        ('agent_constitutions', 'agent_role'),
        ('constitutional_evaluations', 'agent_role'),
        ('constitutional_gate_events', 'agent_role'),
        ('agent_tool_grants', 'agent_role'),
        ('activity_log', 'agent_role'),
        ('agent_activities', 'agent_role'),
        ('agent_growth', 'agent_id'),
        ('agent_memory', 'agent_role'),
        ('agent_reflections', 'agent_role'),
        ('agent_runs', 'agent_id'),
        ('agent_world_model', 'agent_role'),
        ('policy_versions', 'agent_role')
    ) AS t(table_name, column_name)
  LOOP
    IF to_regclass(format('public.%I', rec.table_name)) IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = rec.table_name
          AND column_name = rec.column_name
      )
    THEN
      EXECUTE format(
        'DELETE FROM public.%I WHERE %I = ANY($1)',
        rec.table_name,
        rec.column_name
      )
      USING legacy_roles;
    END IF;
  END LOOP;
END $$;
