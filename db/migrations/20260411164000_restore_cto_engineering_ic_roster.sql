-- Restore the three canonical engineering ICs under CTO (removed by reduce_live_roster_to_core_eight).
-- Roles match db/migrations/20260226000000_insert_sub_team_agents.sql.

BEGIN;

INSERT INTO company_agents (
  role, display_name, name, title, department, team, reports_to, model, status,
  temperature, max_turns, budget_per_run, budget_daily, budget_monthly, is_core,
  is_temporary, expires_at, updated_at, tenant_id, created_via, created_by_client_id,
  authority_scope, thinking_enabled
)
VALUES
  (
    'platform-engineer', 'Alex Park', 'Alex Park', 'Platform Engineer', 'Engineering', 'Engineering', 'cto',
    'model-router', 'active', 0.30, 28, 0.05, 0.50, 15.00, TRUE, FALSE, NULL, NOW(),
    '00000000-0000-0000-0000-000000000000'::uuid, 'internal', NULL, 'green', TRUE
  ),
  (
    'quality-engineer', 'Sam DeLuca', 'Sam DeLuca', 'Quality Engineer', 'Engineering', 'Engineering', 'cto',
    'model-router', 'active', 0.30, 28, 0.05, 0.50, 15.00, TRUE, FALSE, NULL, NOW(),
    '00000000-0000-0000-0000-000000000000'::uuid, 'internal', NULL, 'green', TRUE
  ),
  (
    'devops-engineer', 'Jordan Hayes', 'Jordan Hayes', 'DevOps Engineer', 'Engineering', 'Engineering', 'cto',
    'model-router', 'active', 0.30, 28, 0.05, 0.50, 15.00, TRUE, FALSE, NULL, NOW(),
    '00000000-0000-0000-0000-000000000000'::uuid, 'internal', NULL, 'green', TRUE
  )
ON CONFLICT (role) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  name = EXCLUDED.name,
  title = EXCLUDED.title,
  department = EXCLUDED.department,
  team = EXCLUDED.team,
  reports_to = EXCLUDED.reports_to,
  model = EXCLUDED.model,
  status = 'active',
  temperature = EXCLUDED.temperature,
  max_turns = EXCLUDED.max_turns,
  budget_per_run = EXCLUDED.budget_per_run,
  budget_daily = EXCLUDED.budget_daily,
  budget_monthly = EXCLUDED.budget_monthly,
  is_core = EXCLUDED.is_core,
  is_temporary = EXCLUDED.is_temporary,
  expires_at = EXCLUDED.expires_at,
  tenant_id = EXCLUDED.tenant_id,
  created_via = EXCLUDED.created_via,
  authority_scope = EXCLUDED.authority_scope,
  thinking_enabled = EXCLUDED.thinking_enabled,
  updated_at = NOW();

UPDATE company_agents
SET knowledge_access_scope = ARRAY['engineering', 'infrastructure', 'security', 'devops', 'general']
WHERE role IN ('platform-engineer', 'quality-engineer', 'devops-engineer');

INSERT INTO agent_profiles (
  agent_id, personality_summary, backstory, communication_traits, quirks,
  tone_formality, emoji_usage, verbosity, voice_sample, clifton_strengths, working_style, updated_at, tenant_id
)
SELECT
  t.role,
  t.title || ' at Glyphor.',
  'Core live roster agent.',
  ARRAY[]::TEXT[],
  ARRAY[]::TEXT[],
  0.60,
  0.10,
  0.50,
  NULL,
  ARRAY[]::TEXT[],
  'Core live roster agent.',
  NOW(),
  '00000000-0000-0000-0000-000000000000'::uuid
FROM (VALUES
  ('platform-engineer', 'Platform Engineer'),
  ('quality-engineer', 'Quality Engineer'),
  ('devops-engineer', 'DevOps Engineer')
) AS t(role, title)
WHERE NOT EXISTS (SELECT 1 FROM agent_profiles p WHERE p.agent_id = t.role);

INSERT INTO agent_briefs (agent_id, system_prompt, skills, tools, updated_at, tenant_id)
SELECT
  t.role,
  'System prompt loaded from agent runner code.',
  ARRAY[]::TEXT[],
  ARRAY[]::TEXT[],
  NOW(),
  '00000000-0000-0000-0000-000000000000'::uuid
FROM (VALUES
  ('platform-engineer'),
  ('quality-engineer'),
  ('devops-engineer')
) AS t(role)
WHERE NOT EXISTS (SELECT 1 FROM agent_briefs b WHERE b.agent_id = t.role);

INSERT INTO agent_world_model (
  agent_role, updated_at, strengths, weaknesses, blindspots, preferred_approaches, failure_patterns,
  task_type_scores, tool_proficiency, collaboration_map, last_predictions, prediction_accuracy, improvement_goals, rubric_version, tenant_id
)
SELECT
  t.role, NOW(), '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, '[]'::jsonb,
  '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, 0.5, '[]'::jsonb, 1,
  '00000000-0000-0000-0000-000000000000'::uuid
FROM (VALUES
  ('platform-engineer'),
  ('quality-engineer'),
  ('devops-engineer')
) AS t(role)
ON CONFLICT (agent_role) DO NOTHING;

INSERT INTO agent_trust_scores (
  agent_role, trust_score, domain_scores, score_history, total_runs, successful_runs, human_overrides,
  formal_failures, last_incident, auto_promotion_eligible, suspended, created_at, updated_at
)
SELECT
  t.role, 0.5, '{}'::jsonb, '[]'::jsonb, 0, 0, 0, 0, NULL, FALSE, FALSE, NOW(), NOW()
FROM (VALUES
  ('platform-engineer'),
  ('quality-engineer'),
  ('devops-engineer')
) AS t(role)
ON CONFLICT (agent_role) DO NOTHING;

COMMIT;
