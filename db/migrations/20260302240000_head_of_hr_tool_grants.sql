-- ═══════════════════════════════════════════════════════════════════
-- Head of HR (Jasmine Rivera) — Tool Grants
-- ═══════════════════════════════════════════════════════════════════
-- Jasmine was missing from the original tool grants seeding.
-- This adds baseline system grants for all tools she uses in
-- head-of-hr/tools.ts and her shared tool imports.

-- Domain tools (head-of-hr/tools.ts)
INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by) VALUES
  ('head-of-hr', 'audit_workforce', 'system'),
  ('head-of-hr', 'validate_agent', 'system'),
  ('head-of-hr', 'update_agent_profile', 'system'),
  ('head-of-hr', 'update_agent_name', 'system'),
  ('head-of-hr', 'retire_agent', 'system'),
  ('head-of-hr', 'reactivate_agent', 'system'),
  ('head-of-hr', 'list_stale_agents', 'system'),
  ('head-of-hr', 'set_reports_to', 'system'),
  ('head-of-hr', 'write_hr_log', 'system'),
  ('head-of-hr', 'generate_avatar', 'system'),
  ('head-of-hr', 'provision_agent', 'system'),
  ('head-of-hr', 'enrich_agent_profile', 'system'),
  -- memoryTools
  ('head-of-hr', 'save_memory', 'system'),
  ('head-of-hr', 'recall_memories', 'system'),
  -- communicationTools
  ('head-of-hr', 'send_agent_message', 'system'),
  ('head-of-hr', 'check_messages', 'system'),
  ('head-of-hr', 'call_meeting', 'system'),
  -- toolGrantTools
  ('head-of-hr', 'grant_tool_access', 'system'),
  ('head-of-hr', 'revoke_tool_access', 'system'),
  -- toolRequestTools
  ('head-of-hr', 'request_new_tool', 'system'),
  ('head-of-hr', 'check_tool_request_status', 'system'),
  -- eventTools
  ('head-of-hr', 'emit_insight', 'system'),
  ('head-of-hr', 'emit_alert', 'system'),
  -- graphTools
  ('head-of-hr', 'trace_causes', 'system'),
  ('head-of-hr', 'trace_impact', 'system'),
  ('head-of-hr', 'query_knowledge_graph', 'system'),
  ('head-of-hr', 'add_knowledge', 'system'),
  -- assignmentTools
  ('head-of-hr', 'read_my_assignments', 'system'),
  ('head-of-hr', 'submit_assignment_output', 'system'),
  ('head-of-hr', 'flag_assignment_blocker', 'system'),
  -- emailTools
  ('head-of-hr', 'send_email', 'system'),
  ('head-of-hr', 'read_inbox', 'system'),
  ('head-of-hr', 'reply_to_email', 'system'),
  -- agentCreationTools
  ('head-of-hr', 'create_specialist_agent', 'system'),
  ('head-of-hr', 'list_my_created_agents', 'system'),
  ('head-of-hr', 'retire_created_agent', 'system'),
  -- accessAuditTools
  ('head-of-hr', 'view_access_matrix', 'system'),
  ('head-of-hr', 'view_pending_grant_requests', 'system'),
  -- agentDirectoryTools
  ('head-of-hr', 'get_agent_directory', 'system'),
  ('head-of-hr', 'who_handles', 'system')
ON CONFLICT (agent_role, tool_name) DO NOTHING;
