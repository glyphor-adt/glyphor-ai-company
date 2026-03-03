-- Wave 4: Governance tables and tool grants

-- Legal tables
CREATE TABLE IF NOT EXISTS compliance_checklists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  framework TEXT NOT NULL CHECK (framework IN ('GDPR', 'CCPA', 'SOC2', 'EU_AI_Act')),
  item TEXT NOT NULL,
  status TEXT DEFAULT 'in_progress' CHECK (status IN ('compliant', 'non_compliant', 'in_progress', 'not_applicable')),
  evidence TEXT,
  notes TEXT,
  last_audit_date TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('customer', 'vendor', 'partnership', 'employment')),
  counterparty TEXT NOT NULL,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'pending', 'expired', 'terminated')),
  key_terms JSONB DEFAULT '{}'::jsonb,
  value NUMERIC,
  start_date DATE,
  end_date DATE,
  renewal_date DATE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ip_portfolio (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('patent', 'trademark', 'trade_secret', 'copyright')),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'filed', 'pending', 'granted', 'expired', 'abandoned')),
  filing_date DATE,
  inventor TEXT,
  prior_art_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_compliance_framework ON compliance_checklists(framework);
CREATE INDEX IF NOT EXISTS idx_contracts_type ON contracts(type);
CREATE INDEX IF NOT EXISTS idx_contracts_status ON contracts(status);
CREATE INDEX IF NOT EXISTS idx_contracts_renewal ON contracts(renewal_date);
CREATE INDEX IF NOT EXISTS idx_ip_type ON ip_portfolio(type);

-- RLS
ALTER TABLE compliance_checklists ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ip_portfolio ENABLE ROW LEVEL SECURITY;

CREATE POLICY compliance_system ON compliance_checklists FOR ALL TO glyphor_system_user USING (true) WITH CHECK (true);
CREATE POLICY contracts_system ON contracts FOR ALL TO glyphor_system_user USING (true) WITH CHECK (true);
CREATE POLICY ip_portfolio_system ON ip_portfolio FOR ALL TO glyphor_system_user USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON compliance_checklists TO glyphor_system_user;
GRANT SELECT, INSERT, UPDATE ON contracts TO glyphor_system_user;
GRANT SELECT, INSERT, UPDATE ON ip_portfolio TO glyphor_system_user;

-- Tool grants
INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by) VALUES
  -- CLO (Victoria): all legal tools
  ('clo', 'track_regulations', 'system'),
  ('clo', 'get_compliance_status', 'system'),
  ('clo', 'update_compliance_item', 'system'),
  ('clo', 'create_compliance_alert', 'system'),
  ('clo', 'get_contracts', 'system'),
  ('clo', 'create_contract_review', 'system'),
  ('clo', 'flag_contract_issue', 'system'),
  ('clo', 'get_contract_renewals', 'system'),
  ('clo', 'get_ip_portfolio', 'system'),
  ('clo', 'create_ip_filing', 'system'),
  ('clo', 'monitor_ip_infringement', 'system'),
  ('clo', 'get_tax_calendar', 'system'),
  ('clo', 'calculate_tax_estimate', 'system'),
  ('clo', 'get_tax_research', 'system'),
  ('clo', 'review_tax_strategy', 'system'),
  ('clo', 'audit_data_flows', 'system'),
  ('clo', 'check_data_retention', 'system'),
  ('clo', 'get_privacy_requests', 'system'),
  ('clo', 'audit_access_permissions', 'system'),

  -- Head of HR (Jasmine): all HR tools
  ('head-of-hr', 'get_org_chart', 'system'),
  ('head-of-hr', 'update_agent_profile', 'system'),
  ('head-of-hr', 'get_agent_directory', 'system'),
  ('head-of-hr', 'create_onboarding_plan', 'system'),
  ('head-of-hr', 'get_agent_performance_summary', 'system'),
  ('head-of-hr', 'create_performance_review', 'system'),
  ('head-of-hr', 'run_engagement_survey', 'system'),
  ('head-of-hr', 'get_team_dynamics', 'system'),

  -- Ops (Atlas): ops extension tools
  ('ops', 'get_agent_health_dashboard', 'system'),
  ('ops', 'get_event_bus_health', 'system'),
  ('ops', 'get_data_freshness', 'system'),
  ('ops', 'get_system_costs_realtime', 'system'),
  ('ops', 'create_status_report', 'system'),
  ('ops', 'predict_capacity', 'system'),

  -- Global Admin (Morgan): admin extension tools
  ('global-admin', 'get_access_matrix', 'system'),
  ('global-admin', 'provision_access', 'system'),
  ('global-admin', 'revoke_access', 'system'),
  ('global-admin', 'audit_access', 'system'),
  ('global-admin', 'rotate_secrets', 'system'),
  ('global-admin', 'get_platform_audit_log', 'system')
ON CONFLICT (agent_role, tool_name) DO NOTHING;
