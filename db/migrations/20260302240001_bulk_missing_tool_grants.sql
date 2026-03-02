-- ═══════════════════════════════════════════════════════════════════
-- Bulk Tool Grants — All agents missing from agent_tool_grants
-- ═══════════════════════════════════════════════════════════════════
-- 20 agents were discovered with zero tool grants (plus 1 with
-- incomplete grants and 1 orphaned role). This seeds baseline
-- system grants matching each agent's actual tool imports.

-- ═══════════════════════════════════════════════════════════════════
-- FIX: morgan-blake → global-admin orphan grants
-- The role in company_agents is "global-admin" but grants were
-- inserted under "morgan-blake". Migrate them.
-- ═══════════════════════════════════════════════════════════════════
INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by)
SELECT 'global-admin', tool_name, granted_by
FROM agent_tool_grants WHERE agent_role = 'morgan-blake'
ON CONFLICT (agent_role, tool_name) DO NOTHING;

DELETE FROM agent_tool_grants WHERE agent_role = 'morgan-blake';

-- ═══════════════════════════════════════════════════════════════════
-- 1. AI Impact Analyst (Riya Mehta) — packages/agents/src/ai-impact-analyst/
--    Shared: memory, communication, toolRequest, graph, event, assignment
--    Domain: createResearchTools → web_search, web_fetch, submit_research_packet
-- ═══════════════════════════════════════════════════════════════════
INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by) VALUES
  ('ai-impact-analyst', 'save_memory', 'system'),
  ('ai-impact-analyst', 'recall_memories', 'system'),
  ('ai-impact-analyst', 'send_agent_message', 'system'),
  ('ai-impact-analyst', 'check_messages', 'system'),
  ('ai-impact-analyst', 'call_meeting', 'system'),
  ('ai-impact-analyst', 'request_new_tool', 'system'),
  ('ai-impact-analyst', 'check_tool_request_status', 'system'),
  ('ai-impact-analyst', 'trace_causes', 'system'),
  ('ai-impact-analyst', 'trace_impact', 'system'),
  ('ai-impact-analyst', 'query_knowledge_graph', 'system'),
  ('ai-impact-analyst', 'add_knowledge', 'system'),
  ('ai-impact-analyst', 'emit_insight', 'system'),
  ('ai-impact-analyst', 'emit_alert', 'system'),
  ('ai-impact-analyst', 'read_my_assignments', 'system'),
  ('ai-impact-analyst', 'submit_assignment_output', 'system'),
  ('ai-impact-analyst', 'flag_assignment_blocker', 'system'),
  ('ai-impact-analyst', 'web_search', 'system'),
  ('ai-impact-analyst', 'web_fetch', 'system'),
  ('ai-impact-analyst', 'submit_research_packet', 'system')
ON CONFLICT (agent_role, tool_name) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════
-- 2. CLO (Victoria Chase) — packages/agents/src/clo/
--    Shared: memory, toolGrant, communication, collectiveIntelligence,
--            graph, assignment, email, event, agentCreation, toolRequest,
--            agentDirectory
-- ═══════════════════════════════════════════════════════════════════
INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by) VALUES
  ('clo', 'save_memory', 'system'),
  ('clo', 'recall_memories', 'system'),
  ('clo', 'grant_tool_access', 'system'),
  ('clo', 'revoke_tool_access', 'system'),
  ('clo', 'send_agent_message', 'system'),
  ('clo', 'check_messages', 'system'),
  ('clo', 'call_meeting', 'system'),
  ('clo', 'get_company_pulse', 'system'),
  ('clo', 'update_company_pulse', 'system'),
  ('clo', 'update_pulse_highlights', 'system'),
  ('clo', 'promote_to_org_knowledge', 'system'),
  ('clo', 'get_org_knowledge', 'system'),
  ('clo', 'create_knowledge_route', 'system'),
  ('clo', 'get_knowledge_routes', 'system'),
  ('clo', 'detect_contradictions', 'system'),
  ('clo', 'record_process_pattern', 'system'),
  ('clo', 'get_process_patterns', 'system'),
  ('clo', 'propose_authority_change', 'system'),
  ('clo', 'get_authority_proposals', 'system'),
  ('clo', 'trace_causes', 'system'),
  ('clo', 'trace_impact', 'system'),
  ('clo', 'query_knowledge_graph', 'system'),
  ('clo', 'add_knowledge', 'system'),
  ('clo', 'read_my_assignments', 'system'),
  ('clo', 'submit_assignment_output', 'system'),
  ('clo', 'flag_assignment_blocker', 'system'),
  ('clo', 'send_email', 'system'),
  ('clo', 'read_inbox', 'system'),
  ('clo', 'reply_to_email', 'system'),
  ('clo', 'emit_insight', 'system'),
  ('clo', 'emit_alert', 'system'),
  ('clo', 'create_specialist_agent', 'system'),
  ('clo', 'list_my_created_agents', 'system'),
  ('clo', 'retire_created_agent', 'system'),
  ('clo', 'request_new_tool', 'system'),
  ('clo', 'check_tool_request_status', 'system'),
  ('clo', 'get_agent_directory', 'system'),
  ('clo', 'who_handles', 'system')
ON CONFLICT (agent_role, tool_name) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════
-- 3. Competitive Research Analyst (Lena Park)
--    Same shared tools as other research analysts + research domain
-- ═══════════════════════════════════════════════════════════════════
INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by) VALUES
  ('competitive-research-analyst', 'save_memory', 'system'),
  ('competitive-research-analyst', 'recall_memories', 'system'),
  ('competitive-research-analyst', 'send_agent_message', 'system'),
  ('competitive-research-analyst', 'check_messages', 'system'),
  ('competitive-research-analyst', 'call_meeting', 'system'),
  ('competitive-research-analyst', 'request_new_tool', 'system'),
  ('competitive-research-analyst', 'check_tool_request_status', 'system'),
  ('competitive-research-analyst', 'trace_causes', 'system'),
  ('competitive-research-analyst', 'trace_impact', 'system'),
  ('competitive-research-analyst', 'query_knowledge_graph', 'system'),
  ('competitive-research-analyst', 'add_knowledge', 'system'),
  ('competitive-research-analyst', 'emit_insight', 'system'),
  ('competitive-research-analyst', 'emit_alert', 'system'),
  ('competitive-research-analyst', 'read_my_assignments', 'system'),
  ('competitive-research-analyst', 'submit_assignment_output', 'system'),
  ('competitive-research-analyst', 'flag_assignment_blocker', 'system'),
  ('competitive-research-analyst', 'web_search', 'system'),
  ('competitive-research-analyst', 'web_fetch', 'system'),
  ('competitive-research-analyst', 'submit_research_packet', 'system')
ON CONFLICT (agent_role, tool_name) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════
-- 4. Design Critic (Sofia Marchetti)
--    Shared: memory, communication, toolRequest, event, graph, assignment
--    Domain: grade_build, query_build_grades, run_lighthouse, log_activity
-- ═══════════════════════════════════════════════════════════════════
INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by) VALUES
  ('design-critic', 'save_memory', 'system'),
  ('design-critic', 'recall_memories', 'system'),
  ('design-critic', 'send_agent_message', 'system'),
  ('design-critic', 'check_messages', 'system'),
  ('design-critic', 'call_meeting', 'system'),
  ('design-critic', 'request_new_tool', 'system'),
  ('design-critic', 'check_tool_request_status', 'system'),
  ('design-critic', 'emit_insight', 'system'),
  ('design-critic', 'emit_alert', 'system'),
  ('design-critic', 'trace_causes', 'system'),
  ('design-critic', 'trace_impact', 'system'),
  ('design-critic', 'query_knowledge_graph', 'system'),
  ('design-critic', 'add_knowledge', 'system'),
  ('design-critic', 'read_my_assignments', 'system'),
  ('design-critic', 'submit_assignment_output', 'system'),
  ('design-critic', 'flag_assignment_blocker', 'system'),
  ('design-critic', 'grade_build', 'system'),
  ('design-critic', 'query_build_grades', 'system'),
  ('design-critic', 'run_lighthouse', 'system'),
  ('design-critic', 'log_activity', 'system')
ON CONFLICT (agent_role, tool_name) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════
-- 5. Frontend Engineer (Ava Chen)
--    Shared: memory, communication, toolRequest, event, graph, assignment
--    Domain: run_lighthouse, get_file_contents, push_component,
--            create_component_branch, create_component_pr,
--            save_component_implementation, query_component_specs
-- ═══════════════════════════════════════════════════════════════════
INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by) VALUES
  ('frontend-engineer', 'save_memory', 'system'),
  ('frontend-engineer', 'recall_memories', 'system'),
  ('frontend-engineer', 'send_agent_message', 'system'),
  ('frontend-engineer', 'check_messages', 'system'),
  ('frontend-engineer', 'call_meeting', 'system'),
  ('frontend-engineer', 'request_new_tool', 'system'),
  ('frontend-engineer', 'check_tool_request_status', 'system'),
  ('frontend-engineer', 'emit_insight', 'system'),
  ('frontend-engineer', 'emit_alert', 'system'),
  ('frontend-engineer', 'trace_causes', 'system'),
  ('frontend-engineer', 'trace_impact', 'system'),
  ('frontend-engineer', 'query_knowledge_graph', 'system'),
  ('frontend-engineer', 'add_knowledge', 'system'),
  ('frontend-engineer', 'read_my_assignments', 'system'),
  ('frontend-engineer', 'submit_assignment_output', 'system'),
  ('frontend-engineer', 'flag_assignment_blocker', 'system'),
  ('frontend-engineer', 'run_lighthouse', 'system'),
  ('frontend-engineer', 'get_file_contents', 'system'),
  ('frontend-engineer', 'push_component', 'system'),
  ('frontend-engineer', 'create_component_branch', 'system'),
  ('frontend-engineer', 'create_component_pr', 'system'),
  ('frontend-engineer', 'save_component_implementation', 'system'),
  ('frontend-engineer', 'query_component_specs', 'system')
ON CONFLICT (agent_role, tool_name) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════
-- 6. Global Admin (Morgan Blake)
--    Shared: memory, communication, toolRequest, event, graph,
--            assignment, email, toolGrant
--    Domain: list_project_iam, update_iam_binding, list_service_accounts,
--            create_service_account, list_secrets, create_secret,
--            setup_onboarding, + many GCP/Entra tools
-- ═══════════════════════════════════════════════════════════════════
INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by) VALUES
  -- Shared tools
  ('global-admin', 'save_memory', 'system'),
  ('global-admin', 'recall_memories', 'system'),
  ('global-admin', 'send_agent_message', 'system'),
  ('global-admin', 'check_messages', 'system'),
  ('global-admin', 'call_meeting', 'system'),
  ('global-admin', 'request_new_tool', 'system'),
  ('global-admin', 'check_tool_request_status', 'system'),
  ('global-admin', 'emit_insight', 'system'),
  ('global-admin', 'emit_alert', 'system'),
  ('global-admin', 'trace_causes', 'system'),
  ('global-admin', 'trace_impact', 'system'),
  ('global-admin', 'query_knowledge_graph', 'system'),
  ('global-admin', 'add_knowledge', 'system'),
  ('global-admin', 'read_my_assignments', 'system'),
  ('global-admin', 'submit_assignment_output', 'system'),
  ('global-admin', 'flag_assignment_blocker', 'system'),
  ('global-admin', 'send_email', 'system'),
  ('global-admin', 'read_inbox', 'system'),
  ('global-admin', 'reply_to_email', 'system'),
  ('global-admin', 'grant_tool_access', 'system'),
  ('global-admin', 'revoke_tool_access', 'system')
ON CONFLICT (agent_role, tool_name) DO NOTHING;

-- Global Admin domain tools (30 tools from global-admin/tools.ts)
INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by) VALUES
  ('global-admin', 'list_project_iam', 'system'),
  ('global-admin', 'grant_project_role', 'system'),
  ('global-admin', 'revoke_project_role', 'system'),
  ('global-admin', 'list_service_accounts', 'system'),
  ('global-admin', 'create_service_account', 'system'),
  ('global-admin', 'list_secrets', 'system'),
  ('global-admin', 'get_secret_iam', 'system'),
  ('global-admin', 'grant_secret_access', 'system'),
  ('global-admin', 'revoke_secret_access', 'system'),
  ('global-admin', 'update_secret_value', 'system'),
  ('global-admin', 'rotate_app_credential', 'system'),
  ('global-admin', 'run_access_audit', 'system'),
  ('global-admin', 'run_onboarding', 'system'),
  ('global-admin', 'entra_list_users', 'system'),
  ('global-admin', 'entra_create_user', 'system'),
  ('global-admin', 'entra_disable_user', 'system'),
  ('global-admin', 'entra_enable_user', 'system'),
  ('global-admin', 'entra_list_groups', 'system'),
  ('global-admin', 'entra_list_group_members', 'system'),
  ('global-admin', 'entra_add_group_member', 'system'),
  ('global-admin', 'entra_remove_group_member', 'system'),
  ('global-admin', 'entra_list_directory_roles', 'system'),
  ('global-admin', 'entra_assign_directory_role', 'system'),
  ('global-admin', 'entra_list_app_registrations', 'system'),
  ('global-admin', 'entra_list_licenses', 'system'),
  ('global-admin', 'entra_assign_license', 'system'),
  ('global-admin', 'entra_revoke_license', 'system'),
  ('global-admin', 'entra_audit_sign_ins', 'system'),
  ('global-admin', 'write_admin_log', 'system'),
  ('global-admin', 'check_my_access', 'system')
ON CONFLICT (agent_role, tool_name) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════
-- 7. Industry Research Analyst (Amara Diallo)
-- ═══════════════════════════════════════════════════════════════════
INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by) VALUES
  ('industry-research-analyst', 'save_memory', 'system'),
  ('industry-research-analyst', 'recall_memories', 'system'),
  ('industry-research-analyst', 'send_agent_message', 'system'),
  ('industry-research-analyst', 'check_messages', 'system'),
  ('industry-research-analyst', 'call_meeting', 'system'),
  ('industry-research-analyst', 'request_new_tool', 'system'),
  ('industry-research-analyst', 'check_tool_request_status', 'system'),
  ('industry-research-analyst', 'trace_causes', 'system'),
  ('industry-research-analyst', 'trace_impact', 'system'),
  ('industry-research-analyst', 'query_knowledge_graph', 'system'),
  ('industry-research-analyst', 'add_knowledge', 'system'),
  ('industry-research-analyst', 'emit_insight', 'system'),
  ('industry-research-analyst', 'emit_alert', 'system'),
  ('industry-research-analyst', 'read_my_assignments', 'system'),
  ('industry-research-analyst', 'submit_assignment_output', 'system'),
  ('industry-research-analyst', 'flag_assignment_blocker', 'system'),
  ('industry-research-analyst', 'web_search', 'system'),
  ('industry-research-analyst', 'web_fetch', 'system'),
  ('industry-research-analyst', 'submit_research_packet', 'system')
ON CONFLICT (agent_role, tool_name) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════
-- 8. Market Research Analyst (Daniel Okafor)
-- ═══════════════════════════════════════════════════════════════════
INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by) VALUES
  ('market-research-analyst', 'save_memory', 'system'),
  ('market-research-analyst', 'recall_memories', 'system'),
  ('market-research-analyst', 'send_agent_message', 'system'),
  ('market-research-analyst', 'check_messages', 'system'),
  ('market-research-analyst', 'call_meeting', 'system'),
  ('market-research-analyst', 'request_new_tool', 'system'),
  ('market-research-analyst', 'check_tool_request_status', 'system'),
  ('market-research-analyst', 'trace_causes', 'system'),
  ('market-research-analyst', 'trace_impact', 'system'),
  ('market-research-analyst', 'query_knowledge_graph', 'system'),
  ('market-research-analyst', 'add_knowledge', 'system'),
  ('market-research-analyst', 'emit_insight', 'system'),
  ('market-research-analyst', 'emit_alert', 'system'),
  ('market-research-analyst', 'read_my_assignments', 'system'),
  ('market-research-analyst', 'submit_assignment_output', 'system'),
  ('market-research-analyst', 'flag_assignment_blocker', 'system'),
  ('market-research-analyst', 'web_search', 'system'),
  ('market-research-analyst', 'web_fetch', 'system'),
  ('market-research-analyst', 'submit_research_packet', 'system')
ON CONFLICT (agent_role, tool_name) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════
-- 9. Org Analyst (Marcus Chen)
-- ═══════════════════════════════════════════════════════════════════
INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by) VALUES
  ('org-analyst', 'save_memory', 'system'),
  ('org-analyst', 'recall_memories', 'system'),
  ('org-analyst', 'send_agent_message', 'system'),
  ('org-analyst', 'check_messages', 'system'),
  ('org-analyst', 'call_meeting', 'system'),
  ('org-analyst', 'request_new_tool', 'system'),
  ('org-analyst', 'check_tool_request_status', 'system'),
  ('org-analyst', 'trace_causes', 'system'),
  ('org-analyst', 'trace_impact', 'system'),
  ('org-analyst', 'query_knowledge_graph', 'system'),
  ('org-analyst', 'add_knowledge', 'system'),
  ('org-analyst', 'emit_insight', 'system'),
  ('org-analyst', 'emit_alert', 'system'),
  ('org-analyst', 'read_my_assignments', 'system'),
  ('org-analyst', 'submit_assignment_output', 'system'),
  ('org-analyst', 'flag_assignment_blocker', 'system'),
  ('org-analyst', 'web_search', 'system'),
  ('org-analyst', 'web_fetch', 'system'),
  ('org-analyst', 'submit_research_packet', 'system')
ON CONFLICT (agent_role, tool_name) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════
-- 10. Technical Research Analyst (Kai Nakamura)
-- ═══════════════════════════════════════════════════════════════════
INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by) VALUES
  ('technical-research-analyst', 'save_memory', 'system'),
  ('technical-research-analyst', 'recall_memories', 'system'),
  ('technical-research-analyst', 'send_agent_message', 'system'),
  ('technical-research-analyst', 'check_messages', 'system'),
  ('technical-research-analyst', 'call_meeting', 'system'),
  ('technical-research-analyst', 'request_new_tool', 'system'),
  ('technical-research-analyst', 'check_tool_request_status', 'system'),
  ('technical-research-analyst', 'trace_causes', 'system'),
  ('technical-research-analyst', 'trace_impact', 'system'),
  ('technical-research-analyst', 'query_knowledge_graph', 'system'),
  ('technical-research-analyst', 'add_knowledge', 'system'),
  ('technical-research-analyst', 'emit_insight', 'system'),
  ('technical-research-analyst', 'emit_alert', 'system'),
  ('technical-research-analyst', 'read_my_assignments', 'system'),
  ('technical-research-analyst', 'submit_assignment_output', 'system'),
  ('technical-research-analyst', 'flag_assignment_blocker', 'system'),
  ('technical-research-analyst', 'web_search', 'system'),
  ('technical-research-analyst', 'web_fetch', 'system'),
  ('technical-research-analyst', 'submit_research_packet', 'system')
ON CONFLICT (agent_role, tool_name) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════
-- 11. Template Architect (Ryan Park)
--    Domain: save_template_variant, query_template_variants,
--            update_template_status, query_build_grades_by_template, log_activity
-- ═══════════════════════════════════════════════════════════════════
INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by) VALUES
  ('template-architect', 'save_memory', 'system'),
  ('template-architect', 'recall_memories', 'system'),
  ('template-architect', 'send_agent_message', 'system'),
  ('template-architect', 'check_messages', 'system'),
  ('template-architect', 'call_meeting', 'system'),
  ('template-architect', 'request_new_tool', 'system'),
  ('template-architect', 'check_tool_request_status', 'system'),
  ('template-architect', 'emit_insight', 'system'),
  ('template-architect', 'emit_alert', 'system'),
  ('template-architect', 'trace_causes', 'system'),
  ('template-architect', 'trace_impact', 'system'),
  ('template-architect', 'query_knowledge_graph', 'system'),
  ('template-architect', 'add_knowledge', 'system'),
  ('template-architect', 'read_my_assignments', 'system'),
  ('template-architect', 'submit_assignment_output', 'system'),
  ('template-architect', 'flag_assignment_blocker', 'system'),
  ('template-architect', 'save_template_variant', 'system'),
  ('template-architect', 'query_template_variants', 'system'),
  ('template-architect', 'update_template_status', 'system'),
  ('template-architect', 'query_build_grades_by_template', 'system'),
  ('template-architect', 'log_activity', 'system')
ON CONFLICT (agent_role, tool_name) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════
-- 12. UI/UX Designer (Leo Vargas)
--    Domain: save_component_spec, query_design_tokens,
--            query_component_implementations, log_activity
-- ═══════════════════════════════════════════════════════════════════
INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by) VALUES
  ('ui-ux-designer', 'save_memory', 'system'),
  ('ui-ux-designer', 'recall_memories', 'system'),
  ('ui-ux-designer', 'send_agent_message', 'system'),
  ('ui-ux-designer', 'check_messages', 'system'),
  ('ui-ux-designer', 'call_meeting', 'system'),
  ('ui-ux-designer', 'request_new_tool', 'system'),
  ('ui-ux-designer', 'check_tool_request_status', 'system'),
  ('ui-ux-designer', 'emit_insight', 'system'),
  ('ui-ux-designer', 'emit_alert', 'system'),
  ('ui-ux-designer', 'trace_causes', 'system'),
  ('ui-ux-designer', 'trace_impact', 'system'),
  ('ui-ux-designer', 'query_knowledge_graph', 'system'),
  ('ui-ux-designer', 'add_knowledge', 'system'),
  ('ui-ux-designer', 'read_my_assignments', 'system'),
  ('ui-ux-designer', 'submit_assignment_output', 'system'),
  ('ui-ux-designer', 'flag_assignment_blocker', 'system'),
  ('ui-ux-designer', 'save_component_spec', 'system'),
  ('ui-ux-designer', 'query_design_tokens', 'system'),
  ('ui-ux-designer', 'query_component_implementations', 'system'),
  ('ui-ux-designer', 'log_activity', 'system')
ON CONFLICT (agent_role, tool_name) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════
-- 13. VP Research (Sophia Lin)
--    Shared: memory, toolGrant, communication, toolRequest, graph,
--            event, assignment, email
--    Domain: research tools
-- ═══════════════════════════════════════════════════════════════════
INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by) VALUES
  ('vp-research', 'save_memory', 'system'),
  ('vp-research', 'recall_memories', 'system'),
  ('vp-research', 'grant_tool_access', 'system'),
  ('vp-research', 'revoke_tool_access', 'system'),
  ('vp-research', 'send_agent_message', 'system'),
  ('vp-research', 'check_messages', 'system'),
  ('vp-research', 'call_meeting', 'system'),
  ('vp-research', 'request_new_tool', 'system'),
  ('vp-research', 'check_tool_request_status', 'system'),
  ('vp-research', 'trace_causes', 'system'),
  ('vp-research', 'trace_impact', 'system'),
  ('vp-research', 'query_knowledge_graph', 'system'),
  ('vp-research', 'add_knowledge', 'system'),
  ('vp-research', 'emit_insight', 'system'),
  ('vp-research', 'emit_alert', 'system'),
  ('vp-research', 'read_my_assignments', 'system'),
  ('vp-research', 'submit_assignment_output', 'system'),
  ('vp-research', 'flag_assignment_blocker', 'system'),
  ('vp-research', 'send_email', 'system'),
  ('vp-research', 'read_inbox', 'system'),
  ('vp-research', 'reply_to_email', 'system'),
  ('vp-research', 'web_search', 'system'),
  ('vp-research', 'web_fetch', 'system'),
  ('vp-research', 'submit_research_packet', 'system')
ON CONFLICT (agent_role, tool_name) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════
-- DB-ONLY AGENTS (no run.ts yet, grant baseline shared tools so
-- they'll work when implementations are added)
-- ═══════════════════════════════════════════════════════════════════

-- 14. Bob the Tax Pro (Robert "Bob" Finley) — reports to CLO
INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by) VALUES
  ('bob-the-tax-pro', 'save_memory', 'system'),
  ('bob-the-tax-pro', 'recall_memories', 'system'),
  ('bob-the-tax-pro', 'send_agent_message', 'system'),
  ('bob-the-tax-pro', 'check_messages', 'system'),
  ('bob-the-tax-pro', 'call_meeting', 'system'),
  ('bob-the-tax-pro', 'request_new_tool', 'system'),
  ('bob-the-tax-pro', 'check_tool_request_status', 'system'),
  ('bob-the-tax-pro', 'emit_insight', 'system'),
  ('bob-the-tax-pro', 'emit_alert', 'system'),
  ('bob-the-tax-pro', 'trace_causes', 'system'),
  ('bob-the-tax-pro', 'trace_impact', 'system'),
  ('bob-the-tax-pro', 'query_knowledge_graph', 'system'),
  ('bob-the-tax-pro', 'add_knowledge', 'system'),
  ('bob-the-tax-pro', 'read_my_assignments', 'system'),
  ('bob-the-tax-pro', 'submit_assignment_output', 'system'),
  ('bob-the-tax-pro', 'flag_assignment_blocker', 'system'),
  ('bob-the-tax-pro', 'send_email', 'system'),
  ('bob-the-tax-pro', 'read_inbox', 'system'),
  ('bob-the-tax-pro', 'reply_to_email', 'system')
ON CONFLICT (agent_role, tool_name) DO NOTHING;

-- 15. Data Integrity Auditor (Grace Hwang) — reports to CLO
INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by) VALUES
  ('data-integrity-auditor', 'save_memory', 'system'),
  ('data-integrity-auditor', 'recall_memories', 'system'),
  ('data-integrity-auditor', 'send_agent_message', 'system'),
  ('data-integrity-auditor', 'check_messages', 'system'),
  ('data-integrity-auditor', 'call_meeting', 'system'),
  ('data-integrity-auditor', 'request_new_tool', 'system'),
  ('data-integrity-auditor', 'check_tool_request_status', 'system'),
  ('data-integrity-auditor', 'emit_insight', 'system'),
  ('data-integrity-auditor', 'emit_alert', 'system'),
  ('data-integrity-auditor', 'trace_causes', 'system'),
  ('data-integrity-auditor', 'trace_impact', 'system'),
  ('data-integrity-auditor', 'query_knowledge_graph', 'system'),
  ('data-integrity-auditor', 'add_knowledge', 'system'),
  ('data-integrity-auditor', 'read_my_assignments', 'system'),
  ('data-integrity-auditor', 'submit_assignment_output', 'system'),
  ('data-integrity-auditor', 'flag_assignment_blocker', 'system'),
  ('data-integrity-auditor', 'send_email', 'system'),
  ('data-integrity-auditor', 'read_inbox', 'system'),
  ('data-integrity-auditor', 'reply_to_email', 'system')
ON CONFLICT (agent_role, tool_name) DO NOTHING;

-- 16. Elena Vance (VP Partnerships) — reports to CLO
INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by) VALUES
  ('elena-vance', 'save_memory', 'system'),
  ('elena-vance', 'recall_memories', 'system'),
  ('elena-vance', 'send_agent_message', 'system'),
  ('elena-vance', 'check_messages', 'system'),
  ('elena-vance', 'call_meeting', 'system'),
  ('elena-vance', 'request_new_tool', 'system'),
  ('elena-vance', 'check_tool_request_status', 'system'),
  ('elena-vance', 'emit_insight', 'system'),
  ('elena-vance', 'emit_alert', 'system'),
  ('elena-vance', 'trace_causes', 'system'),
  ('elena-vance', 'trace_impact', 'system'),
  ('elena-vance', 'query_knowledge_graph', 'system'),
  ('elena-vance', 'add_knowledge', 'system'),
  ('elena-vance', 'read_my_assignments', 'system'),
  ('elena-vance', 'submit_assignment_output', 'system'),
  ('elena-vance', 'flag_assignment_blocker', 'system'),
  ('elena-vance', 'send_email', 'system'),
  ('elena-vance', 'read_inbox', 'system'),
  ('elena-vance', 'reply_to_email', 'system')
ON CONFLICT (agent_role, tool_name) DO NOTHING;

-- 17. Enterprise Account Researcher (Ethan Morse) — reports to VP Sales
INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by) VALUES
  ('enterprise-account-researcher', 'save_memory', 'system'),
  ('enterprise-account-researcher', 'recall_memories', 'system'),
  ('enterprise-account-researcher', 'send_agent_message', 'system'),
  ('enterprise-account-researcher', 'check_messages', 'system'),
  ('enterprise-account-researcher', 'call_meeting', 'system'),
  ('enterprise-account-researcher', 'request_new_tool', 'system'),
  ('enterprise-account-researcher', 'check_tool_request_status', 'system'),
  ('enterprise-account-researcher', 'emit_insight', 'system'),
  ('enterprise-account-researcher', 'emit_alert', 'system'),
  ('enterprise-account-researcher', 'trace_causes', 'system'),
  ('enterprise-account-researcher', 'trace_impact', 'system'),
  ('enterprise-account-researcher', 'query_knowledge_graph', 'system'),
  ('enterprise-account-researcher', 'add_knowledge', 'system'),
  ('enterprise-account-researcher', 'read_my_assignments', 'system'),
  ('enterprise-account-researcher', 'submit_assignment_output', 'system'),
  ('enterprise-account-researcher', 'flag_assignment_blocker', 'system'),
  ('enterprise-account-researcher', 'send_email', 'system'),
  ('enterprise-account-researcher', 'read_inbox', 'system'),
  ('enterprise-account-researcher', 'reply_to_email', 'system'),
  ('enterprise-account-researcher', 'web_search', 'system'),
  ('enterprise-account-researcher', 'web_fetch', 'system')
ON CONFLICT (agent_role, tool_name) DO NOTHING;

-- 18. Lead Gen Specialist (Derek Owens) — reports to Chief of Staff
INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by) VALUES
  ('lead-gen-specialist', 'save_memory', 'system'),
  ('lead-gen-specialist', 'recall_memories', 'system'),
  ('lead-gen-specialist', 'send_agent_message', 'system'),
  ('lead-gen-specialist', 'check_messages', 'system'),
  ('lead-gen-specialist', 'call_meeting', 'system'),
  ('lead-gen-specialist', 'request_new_tool', 'system'),
  ('lead-gen-specialist', 'check_tool_request_status', 'system'),
  ('lead-gen-specialist', 'emit_insight', 'system'),
  ('lead-gen-specialist', 'emit_alert', 'system'),
  ('lead-gen-specialist', 'trace_causes', 'system'),
  ('lead-gen-specialist', 'trace_impact', 'system'),
  ('lead-gen-specialist', 'query_knowledge_graph', 'system'),
  ('lead-gen-specialist', 'add_knowledge', 'system'),
  ('lead-gen-specialist', 'read_my_assignments', 'system'),
  ('lead-gen-specialist', 'submit_assignment_output', 'system'),
  ('lead-gen-specialist', 'flag_assignment_blocker', 'system'),
  ('lead-gen-specialist', 'send_email', 'system'),
  ('lead-gen-specialist', 'read_inbox', 'system'),
  ('lead-gen-specialist', 'reply_to_email', 'system'),
  ('lead-gen-specialist', 'web_search', 'system'),
  ('lead-gen-specialist', 'web_fetch', 'system')
ON CONFLICT (agent_role, tool_name) DO NOTHING;

-- 19. Marketing Intelligence Analyst (Zara Petrov) — reports to CMO
INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by) VALUES
  ('marketing-intelligence-analyst', 'save_memory', 'system'),
  ('marketing-intelligence-analyst', 'recall_memories', 'system'),
  ('marketing-intelligence-analyst', 'send_agent_message', 'system'),
  ('marketing-intelligence-analyst', 'check_messages', 'system'),
  ('marketing-intelligence-analyst', 'call_meeting', 'system'),
  ('marketing-intelligence-analyst', 'request_new_tool', 'system'),
  ('marketing-intelligence-analyst', 'check_tool_request_status', 'system'),
  ('marketing-intelligence-analyst', 'emit_insight', 'system'),
  ('marketing-intelligence-analyst', 'emit_alert', 'system'),
  ('marketing-intelligence-analyst', 'trace_causes', 'system'),
  ('marketing-intelligence-analyst', 'trace_impact', 'system'),
  ('marketing-intelligence-analyst', 'query_knowledge_graph', 'system'),
  ('marketing-intelligence-analyst', 'add_knowledge', 'system'),
  ('marketing-intelligence-analyst', 'read_my_assignments', 'system'),
  ('marketing-intelligence-analyst', 'submit_assignment_output', 'system'),
  ('marketing-intelligence-analyst', 'flag_assignment_blocker', 'system'),
  ('marketing-intelligence-analyst', 'send_email', 'system'),
  ('marketing-intelligence-analyst', 'read_inbox', 'system'),
  ('marketing-intelligence-analyst', 'reply_to_email', 'system'),
  ('marketing-intelligence-analyst', 'web_search', 'system'),
  ('marketing-intelligence-analyst', 'web_fetch', 'system')
ON CONFLICT (agent_role, tool_name) DO NOTHING;

-- 20. Tax Strategy Specialist (Mariana Solis) — reports to CLO
INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by) VALUES
  ('tax-strategy-specialist', 'save_memory', 'system'),
  ('tax-strategy-specialist', 'recall_memories', 'system'),
  ('tax-strategy-specialist', 'send_agent_message', 'system'),
  ('tax-strategy-specialist', 'check_messages', 'system'),
  ('tax-strategy-specialist', 'call_meeting', 'system'),
  ('tax-strategy-specialist', 'request_new_tool', 'system'),
  ('tax-strategy-specialist', 'check_tool_request_status', 'system'),
  ('tax-strategy-specialist', 'emit_insight', 'system'),
  ('tax-strategy-specialist', 'emit_alert', 'system'),
  ('tax-strategy-specialist', 'trace_causes', 'system'),
  ('tax-strategy-specialist', 'trace_impact', 'system'),
  ('tax-strategy-specialist', 'query_knowledge_graph', 'system'),
  ('tax-strategy-specialist', 'add_knowledge', 'system'),
  ('tax-strategy-specialist', 'read_my_assignments', 'system'),
  ('tax-strategy-specialist', 'submit_assignment_output', 'system'),
  ('tax-strategy-specialist', 'flag_assignment_blocker', 'system'),
  ('tax-strategy-specialist', 'send_email', 'system'),
  ('tax-strategy-specialist', 'read_inbox', 'system'),
  ('tax-strategy-specialist', 'reply_to_email', 'system')
ON CONFLICT (agent_role, tool_name) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════
-- 21. Adi Rose — reports to Chief of Staff
--     Currently has only 3 grants (send_agent_message, send_dm, send_email).
--     No run.ts implementation yet. Add baseline shared tools.
-- ═══════════════════════════════════════════════════════════════════
INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by) VALUES
  ('adi-rose', 'save_memory', 'system'),
  ('adi-rose', 'recall_memories', 'system'),
  ('adi-rose', 'check_messages', 'system'),
  ('adi-rose', 'call_meeting', 'system'),
  ('adi-rose', 'request_new_tool', 'system'),
  ('adi-rose', 'check_tool_request_status', 'system'),
  ('adi-rose', 'emit_insight', 'system'),
  ('adi-rose', 'emit_alert', 'system'),
  ('adi-rose', 'trace_causes', 'system'),
  ('adi-rose', 'trace_impact', 'system'),
  ('adi-rose', 'query_knowledge_graph', 'system'),
  ('adi-rose', 'add_knowledge', 'system'),
  ('adi-rose', 'read_my_assignments', 'system'),
  ('adi-rose', 'submit_assignment_output', 'system'),
  ('adi-rose', 'flag_assignment_blocker', 'system'),
  ('adi-rose', 'read_inbox', 'system'),
  ('adi-rose', 'reply_to_email', 'system')
ON CONFLICT (agent_role, tool_name) DO NOTHING;
