BEGIN;

WITH keep_roles(role) AS (
  VALUES
    ('chief-of-staff'),
    ('cto'),
    ('cfo'),
    ('cpo'),
    ('cmo'),
    ('vp-customer-success'),
    ('vp-sales'),
    ('vp-design'),
    ('ops'),
    ('platform-engineer'),
    ('quality-engineer'),
    ('devops-engineer'),
    ('user-researcher'),
    ('competitive-intel'),
    ('revenue-analyst'),
    ('cost-analyst'),
    ('content-creator'),
    ('seo-analyst'),
    ('social-media-manager'),
    ('onboarding-specialist'),
    ('support-triage'),
    ('account-research'),
    ('ui-ux-designer'),
    ('frontend-engineer'),
    ('design-critic'),
    ('template-architect')
),
visible_activity_roles(role) AS (
  SELECT role FROM keep_roles
  UNION ALL SELECT 'system'
  UNION ALL SELECT 'founder'
  UNION ALL SELECT 'kristina'
  UNION ALL SELECT 'andrew'
)
DELETE FROM tool_call_traces t
WHERE t.agent_role IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM keep_roles k WHERE k.role = t.agent_role);

WITH keep_roles(role) AS (
  VALUES
    ('chief-of-staff'),
    ('cto'),
    ('cfo'),
    ('cpo'),
    ('cmo'),
    ('vp-customer-success'),
    ('vp-sales'),
    ('vp-design'),
    ('ops'),
    ('platform-engineer'),
    ('quality-engineer'),
    ('devops-engineer'),
    ('user-researcher'),
    ('competitive-intel'),
    ('revenue-analyst'),
    ('cost-analyst'),
    ('content-creator'),
    ('seo-analyst'),
    ('social-media-manager'),
    ('onboarding-specialist'),
    ('support-triage'),
    ('account-research'),
    ('ui-ux-designer'),
    ('frontend-engineer'),
    ('design-critic'),
    ('template-architect')
)
DELETE FROM run_events e
WHERE e.actor_role IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM keep_roles k WHERE k.role = e.actor_role);

WITH keep_roles(role) AS (
  VALUES
    ('chief-of-staff'),
    ('cto'),
    ('cfo'),
    ('cpo'),
    ('cmo'),
    ('vp-customer-success'),
    ('vp-sales'),
    ('vp-design'),
    ('ops'),
    ('platform-engineer'),
    ('quality-engineer'),
    ('devops-engineer'),
    ('user-researcher'),
    ('competitive-intel'),
    ('revenue-analyst'),
    ('cost-analyst'),
    ('content-creator'),
    ('seo-analyst'),
    ('social-media-manager'),
    ('onboarding-specialist'),
    ('support-triage'),
    ('account-research'),
    ('ui-ux-designer'),
    ('frontend-engineer'),
    ('design-critic'),
    ('template-architect')
)
DELETE FROM run_attempts ra
USING run_sessions rs
WHERE rs.id = ra.session_id
  AND (
    (rs.agent_role IS NOT NULL AND NOT EXISTS (SELECT 1 FROM keep_roles k WHERE k.role = rs.agent_role))
    OR
    (rs.primary_agent_role IS NOT NULL AND NOT EXISTS (SELECT 1 FROM keep_roles k WHERE k.role = rs.primary_agent_role))
  );

WITH keep_roles(role) AS (
  VALUES
    ('chief-of-staff'),
    ('cto'),
    ('cfo'),
    ('cpo'),
    ('cmo'),
    ('vp-customer-success'),
    ('vp-sales'),
    ('vp-design'),
    ('ops'),
    ('platform-engineer'),
    ('quality-engineer'),
    ('devops-engineer'),
    ('user-researcher'),
    ('competitive-intel'),
    ('revenue-analyst'),
    ('cost-analyst'),
    ('content-creator'),
    ('seo-analyst'),
    ('social-media-manager'),
    ('onboarding-specialist'),
    ('support-triage'),
    ('account-research'),
    ('ui-ux-designer'),
    ('frontend-engineer'),
    ('design-critic'),
    ('template-architect')
)
DELETE FROM run_sessions rs
WHERE
  (rs.agent_role IS NOT NULL AND NOT EXISTS (SELECT 1 FROM keep_roles k WHERE k.role = rs.agent_role))
  OR
  (rs.primary_agent_role IS NOT NULL AND NOT EXISTS (SELECT 1 FROM keep_roles k WHERE k.role = rs.primary_agent_role));

WITH keep_roles(role) AS (
  VALUES
    ('chief-of-staff'),
    ('cto'),
    ('cfo'),
    ('cpo'),
    ('cmo'),
    ('vp-customer-success'),
    ('vp-sales'),
    ('vp-design'),
    ('ops'),
    ('platform-engineer'),
    ('quality-engineer'),
    ('devops-engineer'),
    ('user-researcher'),
    ('competitive-intel'),
    ('revenue-analyst'),
    ('cost-analyst'),
    ('content-creator'),
    ('seo-analyst'),
    ('social-media-manager'),
    ('onboarding-specialist'),
    ('support-triage'),
    ('account-research'),
    ('ui-ux-designer'),
    ('frontend-engineer'),
    ('design-critic'),
    ('template-architect')
)
DELETE FROM agent_runs ar
WHERE ar.agent_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM keep_roles k WHERE k.role = ar.agent_id);

WITH keep_roles(role) AS (
  VALUES
    ('chief-of-staff'),
    ('cto'),
    ('cfo'),
    ('cpo'),
    ('cmo'),
    ('vp-customer-success'),
    ('vp-sales'),
    ('vp-design'),
    ('ops'),
    ('platform-engineer'),
    ('quality-engineer'),
    ('devops-engineer'),
    ('user-researcher'),
    ('competitive-intel'),
    ('revenue-analyst'),
    ('cost-analyst'),
    ('content-creator'),
    ('seo-analyst'),
    ('social-media-manager'),
    ('onboarding-specialist'),
    ('support-triage'),
    ('account-research'),
    ('ui-ux-designer'),
    ('frontend-engineer'),
    ('design-critic'),
    ('template-architect')
),
visible_activity_roles(role) AS (
  SELECT role FROM keep_roles
  UNION ALL SELECT 'system'
  UNION ALL SELECT 'founder'
  UNION ALL SELECT 'kristina'
  UNION ALL SELECT 'andrew'
)
DELETE FROM activity_log a
WHERE a.agent_role IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM visible_activity_roles v WHERE v.role = a.agent_role);

WITH keep_roles(role) AS (
  VALUES
    ('chief-of-staff'),
    ('cto'),
    ('cfo'),
    ('cpo'),
    ('cmo'),
    ('vp-customer-success'),
    ('vp-sales'),
    ('vp-design'),
    ('ops'),
    ('platform-engineer'),
    ('quality-engineer'),
    ('devops-engineer'),
    ('user-researcher'),
    ('competitive-intel'),
    ('revenue-analyst'),
    ('cost-analyst'),
    ('content-creator'),
    ('seo-analyst'),
    ('social-media-manager'),
    ('onboarding-specialist'),
    ('support-triage'),
    ('account-research'),
    ('ui-ux-designer'),
    ('frontend-engineer'),
    ('design-critic'),
    ('template-architect')
)
DELETE FROM agent_eval_results r
WHERE r.agent_role IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM keep_roles k WHERE k.role = r.agent_role);

WITH keep_roles(role) AS (
  VALUES
    ('chief-of-staff'),
    ('cto'),
    ('cfo'),
    ('cpo'),
    ('cmo'),
    ('vp-customer-success'),
    ('vp-sales'),
    ('vp-design'),
    ('ops'),
    ('platform-engineer'),
    ('quality-engineer'),
    ('devops-engineer'),
    ('user-researcher'),
    ('competitive-intel'),
    ('revenue-analyst'),
    ('cost-analyst'),
    ('content-creator'),
    ('seo-analyst'),
    ('social-media-manager'),
    ('onboarding-specialist'),
    ('support-triage'),
    ('account-research'),
    ('ui-ux-designer'),
    ('frontend-engineer'),
    ('design-critic'),
    ('template-architect')
)
DELETE FROM agent_eval_scenarios s
WHERE s.agent_role IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM keep_roles k WHERE k.role = s.agent_role);

COMMIT;
