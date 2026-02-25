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
  ('chief-of-staff',  'Sarah Chen',      'Sarah Chen',      'Chief of Staff',         'Executive Office',         'gemini-3-flash-preview', 'active', NULL,              true),
  ('cto',             'Marcus Reeves',   'Marcus Reeves',   'Chief Technology Officer','Engineering',              'gemini-3-flash-preview', 'active', 'chief-of-staff',  true),
  ('cpo',             'Elena Vasquez',   'Elena Vasquez',   'Chief Product Officer',   'Product',                  'gemini-3-flash-preview', 'active', 'chief-of-staff',  true),
  ('cfo',             'Nadia Okafor',    'Nadia Okafor',    'Chief Financial Officer', 'Finance',                  'gemini-3-flash-preview', 'active', 'chief-of-staff',  true),
  ('cmo',             'Maya Brooks',     'Maya Brooks',     'Chief Marketing Officer', 'Marketing',                'gemini-3-flash-preview', 'active', 'chief-of-staff',  true),
  ('vp-customer-success','James Turner', 'James Turner',    'VP Customer Success',     'Customer Success',         'gemini-3-flash-preview', 'active', 'chief-of-staff',  true),
  ('vp-sales',        'Rachel Kim',      'Rachel Kim',      'VP Sales',                'Sales',                    'gemini-3-flash-preview', 'active', 'chief-of-staff',  true),
  ('vp-design',       'Mia Tanaka',      'Mia Tanaka',      'VP Design & Frontend',    'Design & Frontend',        'gemini-3-flash-preview', 'active', 'chief-of-staff',  true),
  ('ops',             'Atlas Vega',      'Atlas Vega',      'Operations & System Intelligence','Operations',       'gemini-3-flash-preview', 'active', 'chief-of-staff',  true),
  ('clo',             'Victoria Chase',  'Victoria Chase',  'Chief Legal Officer',     'Legal',                    'gemini-3-flash-preview', 'active', NULL,              true),
  ('vp-research',     'Sophia Lin',      'Sophia Lin',      'VP Research & Intelligence','Research & Intelligence','gemini-3-flash-preview', 'active', 'chief-of-staff',  false),
  -- Global/M365 Admin
  ('global-admin',    'Morgan Blake',    'Morgan Blake',    'Global Administrator',    'Operations & IT',          'gemini-3-flash-preview', 'active', 'chief-of-staff',  true),
  ('m365-admin',      'Riley Morgan',    'Riley Morgan',    'M365 Administrator',      'Operations & IT',          'gemini-3-flash-preview', 'active', 'ops',             true),
  -- Engineering sub-team
  ('platform-engineer','Alex Park',      'Alex Park',       'Platform Engineer',       'Engineering',              'gemini-3-flash-preview', 'active', 'cto',             true),
  ('quality-engineer', 'Sam DeLuca',     'Sam DeLuca',      'Quality Engineer',        'Engineering',              'gemini-3-flash-preview', 'active', 'cto',             true),
  ('devops-engineer',  'Jordan Hayes',   'Jordan Hayes',    'DevOps Engineer',         'Engineering',              'gemini-3-flash-preview', 'active', 'cto',             true),
  -- Product sub-team
  ('user-researcher',  'Priya Sharma',   'Priya Sharma',    'User Researcher',         'Product',                  'gemini-3-flash-preview', 'active', 'cpo',             true),
  ('competitive-intel','Daniel Ortiz',   'Daniel Ortiz',    'Competitive Intel Analyst','Product',                  'gemini-3-flash-preview', 'active', 'cpo',             true),
  -- Finance sub-team
  ('revenue-analyst',  'Anna Park',      'Anna Park',       'Revenue Analyst',         'Finance',                  'gemini-3-flash-preview', 'active', 'cfo',             true),
  ('cost-analyst',     'Omar Hassan',    'Omar Hassan',     'Cost Analyst',            'Finance',                  'gemini-3-flash-preview', 'active', 'cfo',             true),
  -- Marketing sub-team
  ('content-creator',  'Tyler Reed',     'Tyler Reed',      'Content Creator',         'Marketing',                'gemini-3-flash-preview', 'active', 'cmo',             true),
  ('seo-analyst',      'Lisa Chen',      'Lisa Chen',       'SEO Analyst',             'Marketing',                'gemini-3-flash-preview', 'active', 'cmo',             true),
  ('social-media-manager','Kai Johnson', 'Kai Johnson',     'Social Media Manager',    'Marketing',                'gemini-3-flash-preview', 'active', 'cmo',             true),
  -- Customer Success sub-team
  ('onboarding-specialist','Emma Wright','Emma Wright',     'Onboarding Specialist',   'Customer Success',         'gemini-3-flash-preview', 'active', 'vp-customer-success', true),
  ('support-triage',   'David Santos',   'David Santos',    'Support Triage',          'Customer Success',         'gemini-3-flash-preview', 'active', 'vp-customer-success', true),
  -- Sales sub-team
  ('account-research', 'Nathan Cole',    'Nathan Cole',     'Account Research',        'Sales',                    'gemini-3-flash-preview', 'active', 'vp-sales',        true),
  -- Design sub-team
  ('ui-ux-designer',   'Leo Vargas',     'Leo Vargas',      'UI/UX Designer',          'Design & Frontend',        'gemini-3-flash-preview', 'active', 'vp-design',       true),
  ('frontend-engineer','Ava Chen',       'Ava Chen',        'Frontend Engineer',       'Design & Frontend',        'gemini-3-flash-preview', 'active', 'vp-design',       true),
  ('design-critic',    'Sofia Marchetti','Sofia Marchetti', 'Design Critic',           'Design & Frontend',        'gemini-3-flash-preview', 'active', 'vp-design',       true),
  ('template-architect','Ryan Park',     'Ryan Park',       'Template Architect',      'Design & Frontend',        'gemini-3-flash-preview', 'active', 'vp-design',       true),
  -- Research & Intelligence sub-team
  ('competitive-research-analyst','Lena Park',    'Lena Park',     'Competitive Research Analyst','Research & Intelligence','gemini-3-flash-preview', 'active', 'vp-research', false),
  ('market-research-analyst',     'Daniel Okafor','Daniel Okafor', 'Market Research Analyst',     'Research & Intelligence','gemini-3-flash-preview', 'active', 'vp-research', false),
  ('technical-research-analyst',  'Kai Nakamura', 'Kai Nakamura',  'Technical Research Analyst',  'Research & Intelligence','gemini-3-flash-preview', 'active', 'vp-research', false),
  ('industry-research-analyst',   'Amara Diallo', 'Amara Diallo',  'Industry Research Analyst',   'Research & Intelligence','gemini-3-flash-preview', 'active', 'vp-research', false)
ON CONFLICT (role) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  name         = COALESCE(company_agents.name, EXCLUDED.name),
  title        = COALESCE(company_agents.title, EXCLUDED.title),
  department   = COALESCE(company_agents.department, EXCLUDED.department),
  reports_to   = COALESCE(company_agents.reports_to, EXCLUDED.reports_to);
