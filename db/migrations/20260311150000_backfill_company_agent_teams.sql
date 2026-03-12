-- Backfill company_agents.team for checked-in org roles.
-- Safe to re-run: only updates mapped roles whose team differs from the desired value.

ALTER TABLE company_agents ADD COLUMN IF NOT EXISTS team TEXT;

WITH desired_team(role, team) AS (
  VALUES
    ('chief-of-staff', 'Executive'),
    ('cto', 'Executive'),
    ('cpo', 'Executive'),
    ('cmo', 'Executive'),
    ('cfo', 'Executive'),
    ('vp-customer-success', 'Executive'),
    ('vp-sales', 'Executive'),
    ('vp-design', 'Executive'),
    ('clo', 'Legal'),
    ('bob-the-tax-pro', 'Legal'),
    ('data-integrity-auditor', 'Legal'),
    ('tax-strategy-specialist', 'Legal'),
    ('platform-engineer', 'Engineering'),
    ('quality-engineer', 'Engineering'),
    ('devops-engineer', 'Engineering'),
    ('m365-admin', 'Engineering'),
    ('user-researcher', 'Product'),
    ('competitive-intel', 'Product'),
    ('revenue-analyst', 'Finance'),
    ('cost-analyst', 'Finance'),
    ('content-creator', 'Marketing'),
    ('seo-analyst', 'Marketing'),
    ('social-media-manager', 'Marketing'),
    ('marketing-intelligence-analyst', 'Marketing'),
    ('onboarding-specialist', 'Customer Success'),
    ('support-triage', 'Customer Success'),
    ('account-research', 'Sales'),
    ('enterprise-account-researcher', 'Sales'),
    ('lead-gen-specialist', 'Sales'),
    ('ui-ux-designer', 'Design & Frontend'),
    ('frontend-engineer', 'Design & Frontend'),
    ('design-critic', 'Design & Frontend'),
    ('template-architect', 'Design & Frontend'),
    ('vp-research', 'Research & Intelligence'),
    ('competitive-research-analyst', 'Research & Intelligence'),
    ('market-research-analyst', 'Research & Intelligence'),
    ('technical-research-analyst', 'Research & Intelligence'),
    ('industry-research-analyst', 'Research & Intelligence'),
    ('ai-impact-analyst', 'Research & Intelligence'),
    ('org-analyst', 'Research & Intelligence'),
    ('ops', 'Operations'),
    ('global-admin', 'Operations'),
    ('head-of-hr', 'People & Culture'),
    ('adi-rose', 'Executive Support')
)
UPDATE company_agents AS agent
SET team = desired_team.team
FROM desired_team
WHERE agent.role = desired_team.role
  AND agent.team IS DISTINCT FROM desired_team.team;
