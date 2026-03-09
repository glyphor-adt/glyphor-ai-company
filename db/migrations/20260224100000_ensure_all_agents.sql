-- Ensure all agents exist in company_agents (idempotent upserts)
-- This catches any agents that may have been missed by earlier migrations.

ALTER TABLE company_agents ADD COLUMN IF NOT EXISTS department TEXT;
ALTER TABLE company_agents ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE company_agents ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE company_agents ADD COLUMN IF NOT EXISTS reports_to TEXT;
ALTER TABLE company_agents ADD COLUMN IF NOT EXISTS is_core BOOLEAN DEFAULT true;

INSERT INTO company_agents (role, display_name, name, title, department, model, status, reports_to, is_core)
VALUES
  -- Executives
  ('chief-of-staff',  'Sarah Chen',      'Sarah Chen',      'Chief of Staff',         'Executive Office',         'gpt-5-mini-2025-08-07', 'active', NULL,              true),
  ('cto',             'Marcus Reeves',   'Marcus Reeves',   'Chief Technology Officer','Engineering',              'gpt-5-mini-2025-08-07', 'active', 'chief-of-staff',  true),
  ('cpo',             'Elena Vasquez',   'Elena Vasquez',   'Chief Product Officer',   'Product',                  'gpt-5-mini-2025-08-07', 'active', 'chief-of-staff',  true),
  ('cfo',             'Nadia Okafor',    'Nadia Okafor',    'Chief Financial Officer', 'Finance',                  'gpt-5-mini-2025-08-07', 'active', 'chief-of-staff',  true),
  ('cmo',             'Maya Brooks',     'Maya Brooks',     'Chief Marketing Officer', 'Marketing',                'gpt-5-mini-2025-08-07', 'active', 'chief-of-staff',  true),
  ('vp-customer-success','James Turner', 'James Turner',    'VP Customer Success',     'Customer Success',         'gpt-5-mini-2025-08-07', 'active', 'chief-of-staff',  true),
  ('vp-sales',        'Rachel Kim',      'Rachel Kim',      'VP Sales',                'Sales',                    'gpt-5-mini-2025-08-07', 'active', 'chief-of-staff',  true),
  ('vp-design',       'Mia Tanaka',      'Mia Tanaka',      'VP Design & Frontend',    'Design & Frontend',        'gpt-5-mini-2025-08-07', 'active', 'chief-of-staff',  true),
  ('ops',             'Atlas Vega',      'Atlas Vega',      'Operations & System Intelligence','Operations',       'gpt-5-mini-2025-08-07', 'active', 'chief-of-staff',  true),
  ('clo',             'Victoria Chase',  'Victoria Chase',  'Chief Legal Officer',     'Legal',                    'gpt-5-mini-2025-08-07', 'active', NULL,              true),
  ('vp-research',     'Sophia Lin',      'Sophia Lin',      'VP Research & Intelligence','Research & Intelligence','gpt-5-mini-2025-08-07', 'active', 'chief-of-staff',  false),
  -- Global/M365 Admin
  ('global-admin',    'Morgan Blake',    'Morgan Blake',    'Global Administrator',    'Operations & IT',          'gpt-5-mini-2025-08-07', 'active', 'chief-of-staff',  true),
  ('m365-admin',      'Riley Morgan',    'Riley Morgan',    'M365 Administrator',      'Operations & IT',          'gpt-5-mini-2025-08-07', 'active', 'ops',             true),
  -- Engineering sub-team
  ('platform-engineer','Alex Park',      'Alex Park',       'Platform Engineer',       'Engineering',              'gpt-5-mini-2025-08-07', 'active', 'cto',             true),
  ('quality-engineer', 'Sam DeLuca',     'Sam DeLuca',      'Quality Engineer',        'Engineering',              'gpt-5-mini-2025-08-07', 'active', 'cto',             true),
  ('devops-engineer',  'Jordan Hayes',   'Jordan Hayes',    'DevOps Engineer',         'Engineering',              'gpt-5-mini-2025-08-07', 'active', 'cto',             true),
  -- Product sub-team
  ('user-researcher',  'Priya Sharma',   'Priya Sharma',    'User Researcher',         'Product',                  'gpt-5-mini-2025-08-07', 'active', 'cpo',             true),
  ('competitive-intel','Daniel Ortiz',   'Daniel Ortiz',    'Competitive Intel Analyst','Product',                  'gpt-5-mini-2025-08-07', 'active', 'cpo',             true),
  -- Finance sub-team
  ('revenue-analyst',  'Anna Park',      'Anna Park',       'Revenue Analyst',         'Finance',                  'gpt-5-mini-2025-08-07', 'active', 'cfo',             true),
  ('cost-analyst',     'Omar Hassan',    'Omar Hassan',     'Cost Analyst',            'Finance',                  'gpt-5-mini-2025-08-07', 'active', 'cfo',             true),
  -- Marketing sub-team
  ('content-creator',  'Tyler Reed',     'Tyler Reed',      'Content Creator',         'Marketing',                'gpt-5-mini-2025-08-07', 'active', 'cmo',             true),
  ('seo-analyst',      'Lisa Chen',      'Lisa Chen',       'SEO Analyst',             'Marketing',                'gpt-5-mini-2025-08-07', 'active', 'cmo',             true),
  ('social-media-manager','Kai Johnson', 'Kai Johnson',     'Social Media Manager',    'Marketing',                'gpt-5-mini-2025-08-07', 'active', 'cmo',             true),
  -- Customer Success sub-team
  ('onboarding-specialist','Emma Wright','Emma Wright',     'Onboarding Specialist',   'Customer Success',         'gpt-5-mini-2025-08-07', 'active', 'vp-customer-success', true),
  ('support-triage',   'David Santos',   'David Santos',    'Support Triage',          'Customer Success',         'gpt-5-mini-2025-08-07', 'active', 'vp-customer-success', true),
  -- Sales sub-team
  ('account-research', 'Nathan Cole',    'Nathan Cole',     'Account Research',        'Sales',                    'gpt-5-mini-2025-08-07', 'active', 'vp-sales',        true),
  -- Design sub-team
  ('ui-ux-designer',   'Leo Vargas',     'Leo Vargas',      'UI/UX Designer',          'Design & Frontend',        'gpt-5-mini-2025-08-07', 'active', 'vp-design',       true),
  ('frontend-engineer','Ava Chen',       'Ava Chen',        'Frontend Engineer',       'Design & Frontend',        'gpt-5-mini-2025-08-07', 'active', 'vp-design',       true),
  ('design-critic',    'Sofia Marchetti','Sofia Marchetti', 'Design Critic',           'Design & Frontend',        'gpt-5-mini-2025-08-07', 'active', 'vp-design',       true),
  ('template-architect','Ryan Park',     'Ryan Park',       'Template Architect',      'Design & Frontend',        'gpt-5-mini-2025-08-07', 'active', 'vp-design',       true),
  -- Research & Intelligence sub-team
  ('competitive-research-analyst','Lena Park',    'Lena Park',     'Competitive Research Analyst','Research & Intelligence','gpt-5-mini-2025-08-07', 'active', 'vp-research', false),
  ('market-research-analyst',     'Daniel Okafor','Daniel Okafor', 'Market Research Analyst',     'Research & Intelligence','gpt-5-mini-2025-08-07', 'active', 'vp-research', false),
  ('technical-research-analyst',  'Kai Nakamura', 'Kai Nakamura',  'Technical Research Analyst',  'Research & Intelligence','gpt-5-mini-2025-08-07', 'active', 'vp-research', false),
  ('industry-research-analyst',   'Amara Diallo', 'Amara Diallo',  'Industry Research Analyst',   'Research & Intelligence','gpt-5-mini-2025-08-07', 'active', 'vp-research', false)
ON CONFLICT (role) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  name         = COALESCE(company_agents.name, EXCLUDED.name),
  title        = COALESCE(company_agents.title, EXCLUDED.title),
  department   = COALESCE(company_agents.department, EXCLUDED.department),
  reports_to   = COALESCE(company_agents.reports_to, EXCLUDED.reports_to);
