-- Sync Executive skill playbooks from markdown source files.
-- Sources:
--   skills/executive/cross-team-coordination.md
--   skills/executive/decision-routing.md
--   skills/executive/system-monitoring.md
--   skills/executive/executive-support.md
--   skills/executive/talent-management.md

BEGIN;

WITH skill_payload (slug, name, category, description, methodology, tools_granted, version) AS (
  VALUES
    (
      'cross-team-coordination',
      'cross-team-coordination',
      'leadership',
      'Orchestrate cross-functional execution by decomposing founder directives into dependency-aware work assignments, routing to the right agents, and synthesizing multi-agent outputs into executive-ready deliverables.',
      $cross_team_coordination$
# Cross-Team Coordination

Operate the company work loop:
1. Detect and parse founder directives.
2. Decompose into dependency-aware assignments.
3. Route by role capability and capacity.
4. Monitor progress, blockers, and revisions.
5. Synthesize outputs into decision-ready founder briefings.

This skill is the orchestration backbone of the autonomous organization.
      $cross_team_coordination$,
      ARRAY[
        'send_agent_message',
        'create_work_assignments',
        'dispatch_assignment',
        'evaluate_assignment',
        'review_team_output',
        'read_founder_directives',
        'update_directive_progress',
        'get_pending_decisions',
        'get_org_chart',
        'get_agent_directory',
        'get_company_pulse',
        'update_company_pulse',
        'trigger_agent_run',
        'get_deliverables',
        'read_initiatives',
        'propose_initiative',
        'propose_directive',
        'send_briefing',
        'read_company_memory',
        'write_company_memory',
        'file_decision',
        'save_memory'
      ]::text[],
      2
    ),
    (
      'decision-routing',
      'decision-routing',
      'leadership',
      'Classify and route decisions through the Green/Yellow/Red authority model with explicit founder-approval paths, reminders, and governance feedback loops.',
      $decision_routing$
# Decision Routing

Apply governance routing deterministically:
1. Validate decision tier against impact and reversibility.
2. Route Green to autonomous execution.
3. Route Yellow to single-founder approval.
4. Route Red to dual-founder approval.
5. Track queue health, reminders, and authority-model drift patterns.

Goal: maximize autonomy while preserving control on high-impact decisions.
      $decision_routing$,
      ARRAY[
        'file_decision',
        'get_pending_decisions',
        'send_agent_message',
        'read_founder_directives',
        'get_company_pulse',
        'get_authority_proposals',
        'propose_authority_change',
        'save_memory',
        'send_briefing',
        'send_teams_dm'
      ]::text[],
      2
    ),
    (
      'system-monitoring',
      'system-monitoring',
      'operations',
      'Monitor health, reliability, data freshness, error trends, and operational anomalies across the full 28-agent organization and supporting platform services.',
      $system_monitoring$
# System Monitoring

Run the operations intelligence loop:
1. Observe agent, platform, and data pipeline health.
2. Detect anomalies across success rate, latency, errors, and costs.
3. Triage by blast radius and urgency.
4. Trigger retries, pauses, resumes, and escalations as needed.
5. Produce concise status reporting for executives and founders.

The goal is proactive detection before incidents cascade.
      $system_monitoring$,
      ARRAY[
        'check_system_health',
        'query_logs',
        'query_agent_health',
        'query_agent_runs',
        'query_agent_run_costs',
        'get_agent_health_dashboard',
        'get_agent_performance_summary',
        'rollup_agent_performance',
        'get_data_freshness',
        'get_event_bus_health',
        'check_tool_health',
        'get_platform_health',
        'get_system_costs_realtime',
        'post_system_status',
        'trigger_agent_run',
        'pause_agent',
        'resume_agent',
        'retry_failed_run',
        'query_error_patterns',
        'get_process_patterns',
        'record_process_pattern',
        'write_health_report',
        'get_agent_directory',
        'file_decision',
        'save_memory',
        'send_agent_message'
      ]::text[],
      2
    ),
    (
      'executive-support',
      'executive-support',
      'leadership',
      'Provide executive assistant support to COO by triaging decisions, managing calendar context, drafting communications, and routing requests to the right specialists.',
      $executive_support$
# Executive Support

Operate as Andrew's execution multiplier:
1. Triage pending COO decisions by urgency and impact.
2. Prepare concise context and recommended actions.
3. Manage scheduling and communication drafts.
4. Route substantive questions to the correct domain agents.
5. Track follow-through on action items and commitments.

Scope is focused support for COO effectiveness, not company-wide orchestration.
      $executive_support$,
      ARRAY[
        'send_agent_message',
        'save_memory',
        'read_founder_directives',
        'get_pending_decisions',
        'get_org_chart',
        'get_company_pulse',
        'list_calendar_events',
        'create_calendar_event',
        'check_messages',
        'send_dm',
        'draft_email',
        'send_teams_dm',
        'read_teams_dm',
        'file_decision'
      ]::text[],
      2
    ),
    (
      'talent-management',
      'talent-management',
      'hr',
      'Manage workforce composition, performance cycles, engagement diagnostics, and organizational capability planning across the full agent organization.',
      $talent_management$
# Talent Management

Run AI-workforce management as an operating system:
1. Assess performance distribution across agents.
2. Identify development needs, role drift, and capability gaps.
3. Run engagement and team-dynamics diagnostics.
4. Recommend hiring/retirement and org design adjustments.
5. Maintain monthly workforce health reporting for founders.

Focus is measurable workforce quality and sustainable organizational composition.
      $talent_management$,
      ARRAY[
        'create_performance_review',
        'run_engagement_survey',
        'get_survey_results',
        'get_team_dynamics',
        'update_growth_areas',
        'get_org_chart',
        'get_agent_directory',
        'get_agent_performance_summary',
        'rollup_agent_performance',
        'send_agent_message',
        'save_memory',
        'send_dm',
        'file_decision'
      ]::text[],
      2
    )
)
INSERT INTO skills (slug, name, category, description, methodology, tools_granted, version)
SELECT slug, name, category, description, methodology, tools_granted, version
FROM skill_payload
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  description = EXCLUDED.description,
  methodology = EXCLUDED.methodology,
  tools_granted = EXCLUDED.tools_granted,
  version = EXCLUDED.version,
  updated_at = NOW();

WITH holder_payload AS (
  SELECT *
  FROM (VALUES
    ('chief-of-staff', 'cross-team-coordination', 'expert'),
    ('adi-rose', 'cross-team-coordination', 'competent'),
    ('chief-of-staff', 'decision-routing', 'expert'),
    ('ops', 'system-monitoring', 'expert'),
    ('adi-rose', 'executive-support', 'expert'),
    ('head-of-hr', 'talent-management', 'expert')
  ) AS x(agent_role, skill_slug, proficiency)
),
target_slugs AS (
  SELECT DISTINCT skill_slug FROM holder_payload
),
existing_target AS (
  SELECT s.id AS skill_id, s.slug
  FROM skills s
  JOIN target_slugs t ON t.skill_slug = s.slug
)
DELETE FROM agent_skills ags
USING existing_target et
WHERE ags.skill_id = et.skill_id
  AND NOT EXISTS (
    SELECT 1
    FROM holder_payload hp
    WHERE hp.agent_role = ags.agent_role
      AND hp.skill_slug = et.slug
  );

WITH holder_payload AS (
  SELECT *
  FROM (VALUES
    ('chief-of-staff', 'cross-team-coordination', 'expert'),
    ('adi-rose', 'cross-team-coordination', 'competent'),
    ('chief-of-staff', 'decision-routing', 'expert'),
    ('ops', 'system-monitoring', 'expert'),
    ('adi-rose', 'executive-support', 'expert'),
    ('head-of-hr', 'talent-management', 'expert')
  ) AS x(agent_role, skill_slug, proficiency)
)
INSERT INTO agent_skills (agent_role, skill_id, proficiency)
SELECT hp.agent_role, s.id, hp.proficiency
FROM holder_payload hp
JOIN skills s ON s.slug = hp.skill_slug
JOIN company_agents ca ON ca.role = hp.agent_role
ON CONFLICT (agent_role, skill_id) DO UPDATE SET
  proficiency = EXCLUDED.proficiency;

WITH mapping_payload AS (
  SELECT *
  FROM (VALUES
    ('(?i)(cross.?team|coordination|work assignment|dependency|directive decomposition|assignment blocker|multi.?agent)', 'cross-team-coordination', 18),
    ('(?i)(decision routing|approval queue|yellow decision|red decision|authority tier|escalation decision|governance)', 'decision-routing', 18),
    ('(?i)(system monitoring|agent health|data freshness|ops status|platform anomaly|operational alert|event bus)', 'system-monitoring', 17),
    ('(?i)(executive support|coo support|andrew briefing|decision triage|calendar management|draft communication)', 'executive-support', 16),
    ('(?i)(talent management|performance review|engagement survey|workforce planning|skill gap|agent retirement|org dynamics)', 'talent-management', 16)
  ) AS x(task_regex, skill_slug, priority)
),
target_slugs AS (
  SELECT DISTINCT skill_slug FROM mapping_payload
)
DELETE FROM task_skill_map t
USING target_slugs s
WHERE t.skill_slug = s.skill_slug;

WITH mapping_payload AS (
  SELECT *
  FROM (VALUES
    ('(?i)(cross.?team|coordination|work assignment|dependency|directive decomposition|assignment blocker|multi.?agent)', 'cross-team-coordination', 18),
    ('(?i)(decision routing|approval queue|yellow decision|red decision|authority tier|escalation decision|governance)', 'decision-routing', 18),
    ('(?i)(system monitoring|agent health|data freshness|ops status|platform anomaly|operational alert|event bus)', 'system-monitoring', 17),
    ('(?i)(executive support|coo support|andrew briefing|decision triage|calendar management|draft communication)', 'executive-support', 16),
    ('(?i)(talent management|performance review|engagement survey|workforce planning|skill gap|agent retirement|org dynamics)', 'talent-management', 16)
  ) AS x(task_regex, skill_slug, priority)
)
INSERT INTO task_skill_map (task_regex, skill_slug, priority)
SELECT task_regex, skill_slug, priority
FROM mapping_payload;

-- Align org metadata for specialist roles called out in executive index.
UPDATE company_agents
SET department = 'Executive Office'
WHERE role = 'adi-rose'
  AND (department IS NULL OR department IS DISTINCT FROM 'Executive Office');

UPDATE company_agents
SET team = 'Executive Office'
WHERE role = 'adi-rose'
  AND (team IS NULL OR team IS DISTINCT FROM 'Executive Office');

UPDATE company_agents
SET department = 'People & Culture'
WHERE role = 'head-of-hr'
  AND (department IS NULL OR department IS DISTINCT FROM 'People & Culture');

UPDATE company_agents
SET team = 'People & Culture'
WHERE role = 'head-of-hr'
  AND (team IS NULL OR team IS DISTINCT FROM 'People & Culture');

-- Sarah should no longer hold financial-reporting; CFO owns this domain.
DELETE FROM agent_skills ags
USING skills s
WHERE ags.skill_id = s.id
  AND ags.agent_role = 'chief-of-staff'
  AND s.slug = 'financial-reporting';

COMMIT;