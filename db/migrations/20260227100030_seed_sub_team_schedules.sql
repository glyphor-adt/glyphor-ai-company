-- Seed agent_schedules for all sub-team agents.
-- These schedules mirror the SCHEDULED_JOBS defined in cronManager.ts
-- so that the DynamicScheduler can fire them without needing Cloud Scheduler jobs.

INSERT INTO agent_schedules (agent_id, cron_expression, task, enabled, payload)
VALUES
  -- Engineering sub-team (reports to CTO)
  ('platform-engineer', '30 12 * * *', 'health_check', true, '{}'),
  ('quality-engineer',  '0 13 * * *',  'qa_report',    true, '{}'),
  ('devops-engineer',   '0 12 * * *',  'pipeline_report', true, '{}'),

  -- Product sub-team (reports to CPO)
  ('user-researcher',   '30 16 * * *', 'cohort_analysis',  true, '{}'),
  ('competitive-intel', '0 14 * * *',  'landscape_scan',   true, '{}'),

  -- Finance sub-team (reports to CFO)
  ('revenue-analyst',   '30 15 * * *', 'revenue_report', true, '{}'),
  ('cost-analyst',      '30 15 * * *', 'cost_report',    true, '{}'),

  -- Marketing sub-team (reports to CMO)
  ('content-creator',       '0 16 * * *',  'blog_draft',        true, '{}'),
  ('seo-analyst',           '30 14 * * *', 'ranking_report',    true, '{}'),
  ('social-media-manager',  '0 15 * * *',  'schedule_batch',    true, '{}'),
  ('social-media-manager',  '0 22 * * *',  'engagement_report', true, '{}'),

  -- Customer Success sub-team (reports to VP-CS)
  ('onboarding-specialist', '30 14 * * *', 'funnel_report',  true, '{}'),
  ('support-triage',        '0 */2 * * *', 'triage_queue',   true, '{}'),

  -- Sales sub-team (reports to VP-Sales)
  ('account-research', '30 15 * * *', 'prospect_research', true, '{}'),

  -- Design sub-team (reports to VP-Design)
  ('ui-ux-designer',     '0 15 * * *',  'design_review',    true, '{}'),
  ('frontend-engineer',  '30 15 * * *', 'implementation_review', true, '{}'),
  ('design-critic',      '0 16 * * *',  'quality_audit',    true, '{}'),
  ('template-architect', '30 16 * * *', 'template_review',  true, '{}'),

  -- IT / M365 (reports to CTO)
  ('m365-admin', '0 12 * * 1', 'channel_audit', true, '{}'),
  ('m365-admin', '0 13 * * 1', 'user_audit',    true, '{}'),

  -- Ops (Atlas Vega) — high-frequency
  ('ops', '*/10 * * * *', 'health_check',    true, '{}'),
  ('ops', '*/30 * * * *', 'freshness_check', true, '{}'),
  ('ops', '0 * * * *',    'cost_check',      true, '{}'),
  ('ops', '0 11 * * *',   'morning_status',  true, '{}'),
  ('ops', '0 22 * * *',   'evening_status',  true, '{}'),

  -- C-suite schedules not already covered by Cloud Scheduler
  ('cfo', '0 20 * * *', 'daily_cost_check', true, '{"context": "afternoon_check"}'),
  ('cmo', '0 19 * * *', 'generate_content', true, '{"context": "afternoon_publishing"}')
ON CONFLICT DO NOTHING;
