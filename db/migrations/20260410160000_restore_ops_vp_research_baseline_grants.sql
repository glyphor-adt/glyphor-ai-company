BEGIN;

-- After live roster / grant resets: restore baseline DB grants for Ops (critical path)
-- and VP Research (warn-only health + research corpus). Uses default tenant + upsert.

INSERT INTO agent_tool_grants (tenant_id, agent_role, tool_name, granted_by, reason, is_active)
VALUES
  -- Ops (Atlas): fleet control + health (20260227100020 + 20260303160000 governance extras)
  ('00000000-0000-0000-0000-000000000000'::uuid, 'ops', 'query_agent_runs', 'system', 'Baseline ops: run history', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'ops', 'query_agent_health', 'system', 'Baseline ops: per-agent health', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'ops', 'query_data_sync_status', 'system', 'Baseline ops: sync surface', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'ops', 'query_events_backlog', 'system', 'Baseline ops: event backlog', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'ops', 'query_cost_trends', 'system', 'Baseline ops: cost trends', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'ops', 'trigger_agent_run', 'system', 'Baseline ops: run trigger', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'ops', 'retry_failed_run', 'system', 'Baseline ops: retry runs', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'ops', 'retry_data_sync', 'system', 'Baseline ops: retry sync', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'ops', 'pause_agent', 'system', 'Baseline ops: pause agent', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'ops', 'resume_agent', 'system', 'Baseline ops: resume agent', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'ops', 'create_incident', 'system', 'Baseline ops: incidents', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'ops', 'resolve_incident', 'system', 'Baseline ops: incidents', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'ops', 'post_system_status', 'system', 'Baseline ops: status', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'ops', 'rollup_agent_performance', 'system', 'Baseline ops: rollup', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'ops', 'detect_milestones', 'system', 'Baseline ops: milestones', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'ops', 'update_growth_areas', 'system', 'Baseline ops: growth', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'ops', 'send_dm', 'system', 'Baseline ops: DM', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'ops', 'save_memory', 'system', 'Baseline ops: memory', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'ops', 'recall_memories', 'system', 'Baseline ops: recall', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'ops', 'read_my_assignments', 'system', 'Baseline ops: assignments', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'ops', 'submit_assignment_output', 'system', 'Baseline ops: assignments', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'ops', 'flag_assignment_blocker', 'system', 'Baseline ops: assignments', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'ops', 'send_agent_message', 'system', 'Baseline ops: messaging', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'ops', 'check_messages', 'system', 'Baseline ops: messaging', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'ops', 'get_agent_health_dashboard', 'system', 'Governance: dashboard health', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'ops', 'get_event_bus_health', 'system', 'Governance: event bus', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'ops', 'get_data_freshness', 'system', 'Governance: freshness', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'ops', 'get_system_costs_realtime', 'system', 'Governance: realtime costs', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'ops', 'create_status_report', 'system', 'Governance: status report', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'ops', 'predict_capacity', 'system', 'Governance: capacity', true),

  -- VP Research (Sophia): research corpus + exec + comms (20260303150000 + standard exec)
  ('00000000-0000-0000-0000-000000000000'::uuid, 'vp-research', 'save_research', 'system', 'Research: corpus write', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'vp-research', 'search_research', 'system', 'Research: corpus read', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'vp-research', 'get_research_timeline', 'system', 'Research: timeline', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'vp-research', 'create_research_brief', 'system', 'Research: briefs', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'vp-research', 'create_monitor', 'system', 'Research: monitors', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'vp-research', 'check_monitors', 'system', 'Research: monitors', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'vp-research', 'get_monitor_history', 'system', 'Research: monitors', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'vp-research', 'compile_research_digest', 'system', 'Research: digest', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'vp-research', 'identify_research_gaps', 'system', 'Research: gaps', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'vp-research', 'cross_reference_findings', 'system', 'Research: cross-ref', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'vp-research', 'save_memory', 'system', 'Exec: memory', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'vp-research', 'send_agent_message', 'system', 'Exec: agent message', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'vp-research', 'check_messages', 'system', 'Exec: check messages', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'vp-research', 'read_my_assignments', 'system', 'Exec: assignments', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'vp-research', 'submit_assignment_output', 'system', 'Exec: assignments', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'vp-research', 'flag_assignment_blocker', 'system', 'Exec: assignments', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'vp-research', 'read_inbox', 'system', 'Comms: inbox', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'vp-research', 'reply_to_email', 'system', 'Comms: reply', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'vp-research', 'send_email', 'system', 'Comms: send', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'vp-research', 'web_search', 'system', 'Research: web search', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'vp-research', 'web_fetch', 'system', 'Research: web fetch', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'vp-research', 'log_activity', 'system', 'Exec: activity log', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'vp-research', 'read_company_memory', 'system', 'Exec: company memory', true)
ON CONFLICT (agent_role, tool_name) DO UPDATE SET
  granted_by = EXCLUDED.granted_by,
  reason = EXCLUDED.reason,
  is_active = EXCLUDED.is_active,
  tenant_id = EXCLUDED.tenant_id,
  updated_at = NOW();

COMMIT;
