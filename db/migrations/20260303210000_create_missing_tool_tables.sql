-- Create 6 tables referenced by Wave 3-4 tool implementations
-- These tables were referenced in tool code but never created

-- 1. roadmap_items (used by roadmapTools.ts)
CREATE TABLE IF NOT EXISTS roadmap_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title         TEXT NOT NULL,
  description   TEXT,
  product       TEXT,
  priority      TEXT DEFAULT 'medium',
  estimated_effort TEXT,
  expected_impact  TEXT,
  target_quarter   TEXT,
  status        TEXT DEFAULT 'proposed',
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- 2. research_repository (used by researchRepoTools.ts)
CREATE TABLE IF NOT EXISTS research_repository (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic         TEXT NOT NULL,
  category      TEXT,
  content       TEXT,
  sources       JSONB DEFAULT '[]'::jsonb,
  tags          TEXT,
  confidence    NUMERIC,
  author        TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- 3. research_monitors (used by researchMonitoringTools.ts)
CREATE TABLE IF NOT EXISTS research_monitors (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  type            TEXT,
  query_terms     TEXT,
  check_frequency TEXT DEFAULT 'daily',
  alert_threshold NUMERIC,
  created_by      TEXT,
  last_checked    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- 4. compliance_checklists (used by legalTools.ts)
CREATE TABLE IF NOT EXISTS compliance_checklists (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  framework   TEXT NOT NULL,
  item        TEXT NOT NULL,
  status      TEXT DEFAULT 'not_started',
  evidence    TEXT,
  notes       TEXT,
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- 5. contracts (used by legalTools.ts)
CREATE TABLE IF NOT EXISTS contracts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type          TEXT,
  counterparty  TEXT NOT NULL,
  status        TEXT DEFAULT 'draft',
  key_terms     JSONB DEFAULT '{}'::jsonb,
  value         NUMERIC,
  start_date    DATE,
  end_date      DATE,
  renewal_date  DATE,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- 6. ip_portfolio (used by legalTools.ts)
CREATE TABLE IF NOT EXISTS ip_portfolio (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type          TEXT NOT NULL,
  title         TEXT NOT NULL,
  description   TEXT,
  status        TEXT DEFAULT 'draft',
  filing_date   DATE,
  inventor      TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Grant permissions to glyphor_system (used by systemQuery SET ROLE)
GRANT SELECT, INSERT, UPDATE, DELETE ON roadmap_items TO glyphor_system;
GRANT SELECT, INSERT, UPDATE, DELETE ON research_repository TO glyphor_system;
GRANT SELECT, INSERT, UPDATE, DELETE ON research_monitors TO glyphor_system;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance_checklists TO glyphor_system;
GRANT SELECT, INSERT, UPDATE, DELETE ON contracts TO glyphor_system;
GRANT SELECT, INSERT, UPDATE, DELETE ON ip_portfolio TO glyphor_system;

-- Grant permissions to glyphor_system_user (used by agents)
GRANT SELECT, INSERT, UPDATE, DELETE ON roadmap_items TO glyphor_system_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON research_repository TO glyphor_system_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON research_monitors TO glyphor_system_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance_checklists TO glyphor_system_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON contracts TO glyphor_system_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ip_portfolio TO glyphor_system_user;

-- Grant read access to glyphor_app (used by dashboard)
GRANT SELECT ON roadmap_items TO glyphor_app;
GRANT SELECT ON research_repository TO glyphor_app;
GRANT SELECT ON research_monitors TO glyphor_app;
GRANT SELECT ON compliance_checklists TO glyphor_app;
GRANT SELECT ON contracts TO glyphor_app;
GRANT SELECT ON ip_portfolio TO glyphor_app;
