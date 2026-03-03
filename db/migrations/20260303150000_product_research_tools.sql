-- Wave 3: Product + Research tables and tool grants

-- New tables for roadmap and research
CREATE TABLE IF NOT EXISTS roadmap_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  product TEXT NOT NULL CHECK (product IN ('pulse', 'fuse')),
  priority TEXT DEFAULT 'medium' CHECK (priority IN ('critical', 'high', 'medium', 'low')),
  estimated_effort TEXT CHECK (estimated_effort IN ('xs', 's', 'm', 'l', 'xl')),
  expected_impact TEXT CHECK (expected_impact IN ('low', 'medium', 'high', 'transformative')),
  target_quarter TEXT,
  status TEXT DEFAULT 'proposed' CHECK (status IN ('proposed', 'planned', 'in_progress', 'shipped', 'deferred')),
  rice_score NUMERIC,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS research_repository (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('competitive', 'market', 'technical', 'industry', 'ai_impact', 'organizational')),
  content TEXT NOT NULL,
  sources JSONB DEFAULT '[]'::jsonb,
  tags TEXT[] DEFAULT '{}',
  confidence TEXT DEFAULT 'medium' CHECK (confidence IN ('low', 'medium', 'high')),
  author TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS research_monitors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('company', 'topic', 'keyword', 'technology', 'regulation')),
  query_terms TEXT[] NOT NULL DEFAULT '{}',
  check_frequency TEXT DEFAULT 'daily' CHECK (check_frequency IN ('daily', 'weekly')),
  alert_threshold INTEGER DEFAULT 5,
  last_checked TIMESTAMPTZ,
  created_by TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_roadmap_product ON roadmap_items(product);
CREATE INDEX IF NOT EXISTS idx_roadmap_status ON roadmap_items(status);
CREATE INDEX IF NOT EXISTS idx_research_repo_category ON research_repository(category);
CREATE INDEX IF NOT EXISTS idx_research_repo_topic ON research_repository USING gin(to_tsvector('english', topic || ' ' || content));
CREATE INDEX IF NOT EXISTS idx_research_monitors_active ON research_monitors(active) WHERE active = true;

-- RLS policies
ALTER TABLE roadmap_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_repository ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_monitors ENABLE ROW LEVEL SECURITY;

CREATE POLICY roadmap_items_system ON roadmap_items FOR ALL TO glyphor_system_user USING (true) WITH CHECK (true);
CREATE POLICY research_repository_system ON research_repository FOR ALL TO glyphor_system_user USING (true) WITH CHECK (true);
CREATE POLICY research_monitors_system ON research_monitors FOR ALL TO glyphor_system_user USING (true) WITH CHECK (true);

-- Grant table access
GRANT SELECT, INSERT, UPDATE ON roadmap_items TO glyphor_system_user;
GRANT SELECT, INSERT, UPDATE ON research_repository TO glyphor_system_user;
GRANT SELECT, INSERT, UPDATE ON research_monitors TO glyphor_system_user;

-- Tool grants
INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by) VALUES
  -- CPO (Elena): analytics + competitive intel + roadmap
  ('cpo', 'query_analytics_events', 'system'),
  ('cpo', 'get_usage_metrics', 'system'),
  ('cpo', 'get_funnel_analysis', 'system'),
  ('cpo', 'get_cohort_retention', 'system'),
  ('cpo', 'get_feature_usage', 'system'),
  ('cpo', 'segment_users', 'system'),
  ('cpo', 'get_competitor_profile', 'system'),
  ('cpo', 'compare_features', 'system'),
  ('cpo', 'get_market_landscape', 'system'),
  ('cpo', 'create_roadmap_item', 'system'),
  ('cpo', 'score_feature_rice', 'system'),
  ('cpo', 'get_roadmap', 'system'),
  ('cpo', 'update_roadmap_item', 'system'),
  ('cpo', 'get_feature_requests', 'system'),
  ('cpo', 'manage_feature_flags', 'system'),
  ('cpo', 'get_survey_results', 'system'),

  -- User Researcher (Priya): analytics + user research
  ('user-researcher', 'query_analytics_events', 'system'),
  ('user-researcher', 'get_usage_metrics', 'system'),
  ('user-researcher', 'get_funnel_analysis', 'system'),
  ('user-researcher', 'get_feature_usage', 'system'),
  ('user-researcher', 'segment_users', 'system'),
  ('user-researcher', 'create_survey', 'system'),
  ('user-researcher', 'get_survey_results', 'system'),
  ('user-researcher', 'analyze_support_tickets', 'system'),
  ('user-researcher', 'get_user_feedback', 'system'),
  ('user-researcher', 'create_user_persona', 'system'),

  -- Competitive Intel (Daniel Ortiz): all competitive intel tools
  ('competitive-intel', 'track_competitor', 'system'),
  ('competitive-intel', 'get_competitor_profile', 'system'),
  ('competitive-intel', 'update_competitor_profile', 'system'),
  ('competitive-intel', 'compare_features', 'system'),
  ('competitive-intel', 'track_competitor_pricing', 'system'),
  ('competitive-intel', 'monitor_competitor_launches', 'system'),
  ('competitive-intel', 'get_market_landscape', 'system'),

  -- VP Research (Sophia): repo + monitoring + synthesis
  ('vp-research', 'save_research', 'system'),
  ('vp-research', 'search_research', 'system'),
  ('vp-research', 'get_research_timeline', 'system'),
  ('vp-research', 'create_research_brief', 'system'),
  ('vp-research', 'create_monitor', 'system'),
  ('vp-research', 'check_monitors', 'system'),
  ('vp-research', 'get_monitor_history', 'system'),
  ('vp-research', 'compile_research_digest', 'system'),
  ('vp-research', 'identify_research_gaps', 'system'),
  ('vp-research', 'cross_reference_findings', 'system'),

  -- Competitive Research Analyst (Lena): repo + monitoring + competitor product
  ('competitive-research-analyst', 'save_research', 'system'),
  ('competitive-research-analyst', 'search_research', 'system'),
  ('competitive-research-analyst', 'create_monitor', 'system'),
  ('competitive-research-analyst', 'check_monitors', 'system'),
  ('competitive-research-analyst', 'get_monitor_history', 'system'),
  ('competitive-research-analyst', 'track_competitor_product', 'system'),

  -- Market Research Analyst (Daniel Okafor): repo + monitoring
  ('market-research-analyst', 'save_research', 'system'),
  ('market-research-analyst', 'search_research', 'system'),
  ('market-research-analyst', 'create_monitor', 'system'),
  ('market-research-analyst', 'check_monitors', 'system'),
  ('market-research-analyst', 'get_monitor_history', 'system'),

  -- Technical Research Analyst (Kai): repo + monitoring + academic + OSS
  ('technical-research-analyst', 'save_research', 'system'),
  ('technical-research-analyst', 'search_research', 'system'),
  ('technical-research-analyst', 'create_monitor', 'system'),
  ('technical-research-analyst', 'check_monitors', 'system'),
  ('technical-research-analyst', 'get_monitor_history', 'system'),
  ('technical-research-analyst', 'search_academic_papers', 'system'),
  ('technical-research-analyst', 'track_open_source', 'system'),

  -- Industry Research Analyst (Amara): repo + monitoring + events + regulatory
  ('industry-research-analyst', 'save_research', 'system'),
  ('industry-research-analyst', 'search_research', 'system'),
  ('industry-research-analyst', 'create_monitor', 'system'),
  ('industry-research-analyst', 'check_monitors', 'system'),
  ('industry-research-analyst', 'get_monitor_history', 'system'),
  ('industry-research-analyst', 'track_industry_events', 'system'),
  ('industry-research-analyst', 'track_regulatory_changes', 'system'),

  -- AI Impact Analyst (Riya): repo + monitoring + adoption + benchmarks
  ('ai-impact-analyst', 'save_research', 'system'),
  ('ai-impact-analyst', 'search_research', 'system'),
  ('ai-impact-analyst', 'create_monitor', 'system'),
  ('ai-impact-analyst', 'check_monitors', 'system'),
  ('ai-impact-analyst', 'get_monitor_history', 'system'),
  ('ai-impact-analyst', 'analyze_ai_adoption', 'system'),
  ('ai-impact-analyst', 'track_ai_benchmarks', 'system'),

  -- Org Analyst (Marcus): repo + monitoring + org structure
  ('org-analyst', 'save_research', 'system'),
  ('org-analyst', 'search_research', 'system'),
  ('org-analyst', 'create_monitor', 'system'),
  ('org-analyst', 'check_monitors', 'system'),
  ('org-analyst', 'get_monitor_history', 'system'),
  ('org-analyst', 'analyze_org_structure', 'system'),

  -- Account Research: repo + monitoring
  ('account-research', 'save_research', 'system'),
  ('account-research', 'search_research', 'system'),
  ('account-research', 'create_monitor', 'system'),
  ('account-research', 'check_monitors', 'system'),
  ('account-research', 'get_monitor_history', 'system')
ON CONFLICT (agent_role, tool_name) DO NOTHING;
