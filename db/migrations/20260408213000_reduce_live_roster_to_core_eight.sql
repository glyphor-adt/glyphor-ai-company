BEGIN;

-- Hard reset the live roster down to the founder-approved core eight.
-- This intentionally removes agent runtime/operational history so the kept
-- roster restarts from a clean state with only baseline config preserved.

CREATE TEMP TABLE tmp_keep_roles (
  role TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  title TEXT NOT NULL,
  department TEXT NOT NULL,
  team TEXT NOT NULL,
  reports_to TEXT
) ON COMMIT DROP;

INSERT INTO tmp_keep_roles (role, display_name, title, department, team, reports_to) VALUES
  ('chief-of-staff', 'Sarah Chen', 'Chief of Staff', 'Executive Office', 'Executive', NULL),
  ('cto', 'Marcus Reeves', 'Chief Technology Officer', 'Engineering', 'Executive', 'chief-of-staff'),
  ('cfo', 'Nadia Okafor', 'Chief Financial Officer', 'Finance', 'Executive', 'chief-of-staff'),
  ('cpo', 'Elena Vasquez', 'Chief Product Officer', 'Product', 'Executive', 'chief-of-staff'),
  ('cmo', 'Maya Brooks', 'Chief Marketing Officer', 'Marketing', 'Executive', 'chief-of-staff'),
  ('vp-design', 'Mia Tanaka', 'VP Design & Frontend', 'Design & Frontend', 'Executive', 'chief-of-staff'),
  ('ops', 'Atlas Vega', 'Operations & System Intelligence', 'Operations & IT', 'Operations', 'chief-of-staff'),
  ('vp-research', 'Sophia Lin', 'VP Research & Intelligence', 'Research & Intelligence', 'Executive', 'chief-of-staff');

CREATE TEMP TABLE tmp_all_agent_roles ON COMMIT DROP AS
SELECT role FROM tmp_keep_roles
UNION
SELECT role FROM company_agents
UNION
SELECT agent_id FROM agent_profiles
UNION
SELECT agent_id FROM agent_briefs
UNION
SELECT agent_id FROM agent_schedules
UNION
SELECT agent_role FROM agent_skills
UNION
SELECT agent_role FROM agent_tool_grants
UNION
SELECT agent_role FROM agent_reasoning_config
UNION
SELECT source_agent FROM proposed_skills
UNION
SELECT agent_role FROM agent_memory
UNION
SELECT agent_role FROM agent_reflections
UNION
SELECT from_agent FROM agent_messages
UNION
SELECT to_agent FROM agent_messages
UNION
SELECT called_by FROM agent_meetings
UNION
SELECT agent_role FROM chat_messages
UNION
SELECT agent_role FROM conversation_memory_summaries
UNION
SELECT assigned_to FROM work_assignments
UNION
SELECT assigned_by FROM work_assignments WHERE assigned_by IS NOT NULL
UNION
SELECT producing_agent FROM deliverables
UNION
SELECT owner_role FROM initiatives
UNION
SELECT initiator_role FROM workflows
UNION
SELECT primary_agent_role FROM run_sessions
UNION
SELECT agent_id FROM agent_runs
UNION
SELECT agent_role FROM agent_run_status
UNION
SELECT agent_id FROM fleet_findings
UNION
SELECT agent_id FROM commitment_registry
UNION
SELECT agent_id FROM disclosure_audit_log
UNION
SELECT agent_role FROM agent_world_model_evidence
UNION
SELECT agent_id FROM agent_world_model_corrections
UNION
SELECT agent_role FROM agent_trust_scores
UNION
SELECT proposed_by FROM decisions
UNION
SELECT resolved_by FROM decisions
UNION
SELECT unnest(assigned_to) FROM decisions WHERE assigned_to IS NOT NULL
UNION
SELECT unnest(consumed_by) FROM deliverables WHERE consumed_by IS NOT NULL;

CREATE TEMP TABLE tmp_keep_agent_profiles ON COMMIT DROP AS
SELECT *
FROM agent_profiles
WHERE agent_id IN (SELECT role FROM tmp_keep_roles);

CREATE TEMP TABLE tmp_keep_agent_briefs ON COMMIT DROP AS
SELECT *
FROM agent_briefs
WHERE agent_id IN (SELECT role FROM tmp_keep_roles);

CREATE TEMP TABLE tmp_keep_agent_reasoning_config ON COMMIT DROP AS
SELECT *
FROM agent_reasoning_config
WHERE agent_role IN (SELECT role FROM tmp_keep_roles);

CREATE TEMP TABLE tmp_keep_agent_constitutions ON COMMIT DROP AS
SELECT *
FROM agent_constitutions
WHERE agent_role IN (SELECT role FROM tmp_keep_roles)
  AND active = TRUE;

CREATE TEMP TABLE tmp_keep_agent_disclosure_config ON COMMIT DROP AS
SELECT *
FROM agent_disclosure_config
WHERE agent_id IN (SELECT role FROM tmp_keep_roles);

CREATE TEMP TABLE tmp_keep_agent_capacity_config ON COMMIT DROP AS
SELECT *
FROM agent_capacity_config
WHERE agent_id IN (SELECT role FROM tmp_keep_roles);

CREATE TEMP TABLE tmp_keep_agent_schedules ON COMMIT DROP AS
SELECT id, agent_id, cron_expression, task, enabled, created_at, payload, tenant_id
FROM agent_schedules
WHERE agent_id IN (SELECT role FROM tmp_keep_roles);

CREATE TEMP TABLE tmp_keep_agent_skills ON COMMIT DROP AS
SELECT id, agent_role, skill_id, proficiency, assigned_at
FROM agent_skills
WHERE agent_role IN (SELECT role FROM tmp_keep_roles);

CREATE TEMP TABLE tmp_keep_agent_tool_grants ON COMMIT DROP AS
SELECT id, agent_role, tool_name, granted_by, reason, scope, created_at, updated_at, tenant_id
FROM agent_tool_grants
WHERE agent_role IN (SELECT role FROM tmp_keep_roles)
  AND is_active = TRUE
  AND directive_id IS NULL
  AND expires_at IS NULL;

CREATE TEMP TABLE tmp_decisions_to_delete ON COMMIT DROP AS
SELECT d.id
FROM decisions d
WHERE d.proposed_by IN (SELECT role FROM tmp_all_agent_roles)
   OR d.resolved_by IN (SELECT role FROM tmp_all_agent_roles)
   OR COALESCE(d.assigned_to, ARRAY[]::TEXT[]) && (SELECT ARRAY_AGG(role) FROM tmp_all_agent_roles);

UPDATE product_proposals
SET decision_id = NULL
WHERE decision_id IN (SELECT id FROM tmp_decisions_to_delete);

DELETE FROM approval_tokens;
DELETE FROM platform_intel_actions;
DELETE FROM platform_intel_reports;

DELETE FROM handoff_traces;
DELETE FROM agent_handoff_contracts;
DELETE FROM handoffs;

DELETE FROM decision_traces;
DELETE FROM action_reversals;
DELETE FROM activity_log
WHERE agent_id IS NOT NULL
   OR COALESCE(agent_role, 'system') <> 'system';

DELETE FROM social_publish_audit_log;
DELETE FROM social_metrics;
DELETE FROM scheduled_posts;
DELETE FROM content_drafts;

DELETE FROM deliverables;

DELETE FROM decisions
WHERE id IN (SELECT id FROM tmp_decisions_to_delete);

DELETE FROM assignment_evaluations;
DELETE FROM task_run_outcomes;
DELETE FROM tool_call_traces;
DELETE FROM constitutional_gate_events;
DELETE FROM constitutional_evaluations;
DELETE FROM reasoning_passes;
DELETE FROM value_assessments;
DELETE FROM shadow_runs;
DELETE FROM agent_prediction_journal;
DELETE FROM agent_run_status;
DELETE FROM agent_run_events;
DELETE FROM agent_claim_evidence_links;
DELETE FROM agent_run_evidence;
DELETE FROM agent_failure_taxonomy;

DELETE FROM run_events;
DELETE FROM run_attempts;
DELETE FROM run_sessions;
DELETE FROM agent_runs;

DELETE FROM workflows
WHERE initiator_role IN (SELECT role FROM tmp_all_agent_roles);

DELETE FROM work_assignments;

DELETE FROM chat_messages;
DELETE FROM conversation_memory_summaries;
DELETE FROM agent_messages;
DELETE FROM agent_meetings;
DELETE FROM agent_wake_queue;

DELETE FROM agent_performance;
DELETE FROM agent_milestones;
DELETE FROM agent_growth;
DELETE FROM agent_peer_feedback;
DELETE FROM fleet_findings;
DELETE FROM agent_metrics_cache;

DELETE FROM proposed_skills;

DELETE FROM agent_world_model_corrections;
DELETE FROM agent_world_model_evidence;
DELETE FROM agent_memory;
DELETE FROM agent_reflections;
DELETE FROM shared_procedures;
DELETE FROM shared_episodes;
DELETE FROM memory_lifecycle
WHERE source_table IN (
  'agent_memory',
  'agent_reflections',
  'shared_episodes',
  'shared_procedures',
  'conversation_memory_summaries'
);
DELETE FROM memory_archive
WHERE source_table IN (
  'agent_memory',
  'agent_reflections',
  'shared_episodes',
  'shared_procedures',
  'conversation_memory_summaries'
)
   OR agent_role IN (SELECT role FROM tmp_all_agent_roles);

DELETE FROM commitment_registry
WHERE agent_id IN (SELECT role FROM tmp_all_agent_roles);

DELETE FROM disclosure_audit_log
WHERE agent_id IN (SELECT role FROM tmp_all_agent_roles);

DELETE FROM agent_world_model;
DELETE FROM agent_trust_scores;

DELETE FROM agent_eval_results
WHERE agent_role NOT IN (SELECT role FROM tmp_keep_roles);
DELETE FROM agent_eval_scenarios
WHERE agent_role NOT IN (SELECT role FROM tmp_keep_roles);

DELETE FROM agent_capacity_config;
DELETE FROM agent_disclosure_config;
DELETE FROM agent_constitutions;
DELETE FROM agent_reasoning_config;
DELETE FROM agent_tool_grants;
DELETE FROM agent_skills;
DELETE FROM agent_schedules;
DELETE FROM agent_briefs;
DELETE FROM agent_profiles;

DELETE FROM company_agents
WHERE role NOT IN (SELECT role FROM tmp_keep_roles);

UPDATE company_agents AS ca
SET display_name = COALESCE(NULLIF(ca.display_name, ''), keep.display_name),
    name = COALESCE(NULLIF(ca.name, ''), COALESCE(NULLIF(ca.display_name, ''), keep.display_name)),
    title = COALESCE(NULLIF(ca.title, ''), keep.title),
    department = keep.department,
    team = keep.team,
    reports_to = keep.reports_to,
    status = 'active',
    is_core = TRUE,
    is_temporary = FALSE,
    expires_at = NULL,
    tenant_id = COALESCE(ca.tenant_id, '00000000-0000-0000-0000-000000000000'::uuid),
    created_via = 'internal',
    created_by_client_id = NULL,
    authority_scope = COALESCE(ca.authority_scope, 'green'),
    model = COALESCE(NULLIF(ca.model, ''), 'model-router'),
    temperature = COALESCE(ca.temperature, 0.30),
    max_turns = COALESCE(ca.max_turns, 10),
    budget_per_run = COALESCE(ca.budget_per_run, 0.05),
    budget_daily = COALESCE(ca.budget_daily, 0.50),
    budget_monthly = COALESCE(ca.budget_monthly, 15.00),
    thinking_enabled = COALESCE(ca.thinking_enabled, TRUE),
    last_run_at = NULL,
    last_run_duration_ms = NULL,
    last_run_cost_usd = NULL,
    performance_score = NULL,
    total_runs = 0,
    total_cost_usd = 0,
    last_run_summary = NULL,
    updated_at = NOW()
FROM tmp_keep_roles keep
WHERE ca.role = keep.role;

INSERT INTO company_agents (
  role, display_name, name, title, department, team, reports_to, model, status,
  temperature, max_turns, budget_per_run, budget_daily, budget_monthly, is_core,
  is_temporary, expires_at, updated_at, tenant_id, created_via, created_by_client_id,
  authority_scope, thinking_enabled
)
SELECT
  keep.role, keep.display_name, keep.display_name, keep.title, keep.department, keep.team,
  keep.reports_to, 'model-router', 'active', 0.30, 10, 0.05, 0.50, 15.00, TRUE, FALSE,
  NULL, NOW(), '00000000-0000-0000-0000-000000000000'::uuid, 'internal', NULL, 'green', TRUE
FROM tmp_keep_roles keep
WHERE NOT EXISTS (SELECT 1 FROM company_agents ca WHERE ca.role = keep.role);

INSERT INTO agent_profiles
SELECT * FROM tmp_keep_agent_profiles;

INSERT INTO agent_profiles (
  agent_id, avatar_emoji, personality_summary, backstory, communication_traits, quirks,
  tone_formality, emoji_usage, verbosity, voice_sample, clifton_strengths, working_style, updated_at
)
SELECT
  keep.role,
  CASE WHEN keep.role = 'vp-research' THEN '📋' ELSE '🤖' END,
  keep.title || ' at Glyphor.',
  'Core live roster agent.',
  ARRAY[]::TEXT[],
  ARRAY[]::TEXT[],
  0.60,
  0.10,
  0.50,
  NULL,
  ARRAY[]::TEXT[],
  'Core live roster agent.',
  NOW()
FROM tmp_keep_roles keep
WHERE NOT EXISTS (
  SELECT 1 FROM agent_profiles profile WHERE profile.agent_id = keep.role
);

INSERT INTO agent_briefs
SELECT * FROM tmp_keep_agent_briefs;

INSERT INTO agent_briefs (agent_id, system_prompt, skills, tools, updated_at)
SELECT keep.role, 'System prompt loaded from agent runner code.', ARRAY[]::TEXT[], ARRAY[]::TEXT[], NOW()
FROM tmp_keep_roles keep
WHERE NOT EXISTS (
  SELECT 1 FROM agent_briefs brief WHERE brief.agent_id = keep.role
);

INSERT INTO agent_reasoning_config
SELECT * FROM tmp_keep_agent_reasoning_config;

INSERT INTO agent_constitutions
SELECT * FROM tmp_keep_agent_constitutions;

INSERT INTO agent_disclosure_config
SELECT * FROM tmp_keep_agent_disclosure_config
ON CONFLICT (agent_id) DO UPDATE
SET disclosure_level = EXCLUDED.disclosure_level,
    email_signature_template = EXCLUDED.email_signature_template,
    display_name_suffix = EXCLUDED.display_name_suffix,
    external_commitment_gate = EXCLUDED.external_commitment_gate,
    updated_at = EXCLUDED.updated_at;

INSERT INTO agent_disclosure_config (
  agent_id, disclosure_level, email_signature_template, display_name_suffix, external_commitment_gate, updated_at
)
SELECT
  keep.role,
  'internal_only'::disclosure_level,
  'This message was composed by {{agent_name}} ({{agent_role}}), an AI assistant operating on behalf of {{company_name}} using Glyphor''s Autonomous Development Teams platform.',
  ' (AI)',
  TRUE,
  NOW()
FROM tmp_keep_roles keep
WHERE NOT EXISTS (
  SELECT 1 FROM agent_disclosure_config cfg WHERE cfg.agent_id = keep.role
);

INSERT INTO agent_capacity_config
SELECT * FROM tmp_keep_agent_capacity_config
ON CONFLICT (agent_id) DO UPDATE
SET capacity_tier = EXCLUDED.capacity_tier,
    requires_human_approval_for = EXCLUDED.requires_human_approval_for,
    override_by_roles = EXCLUDED.override_by_roles,
    updated_at = EXCLUDED.updated_at,
    updated_by = EXCLUDED.updated_by,
    metadata = EXCLUDED.metadata;

INSERT INTO agent_capacity_config (
  agent_id, capacity_tier, requires_human_approval_for, override_by_roles, updated_at, updated_by, metadata
)
SELECT
  ca.role,
  defaults_row.capacity_tier,
  defaults_row.requires_human_approval_for,
  defaults_row.override_by_roles,
  NOW(),
  'migration:reduce-live-roster-to-core-eight',
  jsonb_strip_nulls(
    jsonb_build_object(
      'role_category', defaults_row.role_category,
      'commit_value_threshold', defaults_row.commit_value_threshold,
      'commit_requires_dual_approval', defaults_row.commit_requires_dual_approval
    )
  )
FROM company_agents ca
CROSS JOIN LATERAL match_agent_capacity_role_default(ca.role, ca.department, ca.title) AS defaults_row
WHERE ca.role IN (SELECT role FROM tmp_keep_roles)
  AND NOT EXISTS (
    SELECT 1 FROM agent_capacity_config cfg WHERE cfg.agent_id = ca.role
  );

INSERT INTO agent_schedules (
  id, agent_id, cron_expression, task, enabled, last_triggered_at, created_at, payload, tenant_id
)
SELECT
  id, agent_id, cron_expression, task, enabled, NULL, created_at, payload, tenant_id
FROM tmp_keep_agent_schedules;

INSERT INTO agent_skills (
  id, agent_role, skill_id, proficiency, times_used, successes, failures, last_used_at, learned_refinements, failure_modes, assigned_at
)
SELECT
  id, agent_role, skill_id, proficiency, 0, 0, 0, NULL, ARRAY[]::TEXT[], ARRAY[]::TEXT[], assigned_at
FROM tmp_keep_agent_skills;

INSERT INTO agent_tool_grants (
  id, agent_role, tool_name, granted_by, reason, directive_id, scope, is_active, expires_at, created_at, updated_at, tenant_id
)
SELECT
  id, agent_role, tool_name, granted_by, reason, NULL, scope, TRUE, NULL, created_at, updated_at, tenant_id
FROM tmp_keep_agent_tool_grants;

INSERT INTO agent_world_model (
  agent_role, updated_at, strengths, weaknesses, blindspots, preferred_approaches, failure_patterns,
  task_type_scores, tool_proficiency, collaboration_map, last_predictions, prediction_accuracy, improvement_goals, rubric_version, tenant_id
)
SELECT
  keep.role, NOW(), '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, '[]'::jsonb,
  '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, 0.5, '[]'::jsonb, 1,
  '00000000-0000-0000-0000-000000000000'::uuid
FROM tmp_keep_roles keep;

INSERT INTO agent_trust_scores (
  agent_role, trust_score, domain_scores, score_history, total_runs, successful_runs, human_overrides,
  formal_failures, last_incident, auto_promotion_eligible, suspended, created_at, updated_at
)
SELECT
  keep.role, 0.5, '{}'::jsonb, '[]'::jsonb, 0, 0, 0, 0, NULL, FALSE, FALSE, NOW(), NOW()
FROM tmp_keep_roles keep;

COMMIT;
