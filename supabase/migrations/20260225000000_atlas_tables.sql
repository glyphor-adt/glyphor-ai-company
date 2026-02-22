-- Atlas Vega tables: data_sync_status, incidents, system_status

-- Track data sync freshness
CREATE TABLE IF NOT EXISTS data_sync_status (
  id TEXT PRIMARY KEY,
  last_success_at TIMESTAMPTZ,
  last_failure_at TIMESTAMPTZ,
  last_error TEXT,
  consecutive_failures INT DEFAULT 0,
  status TEXT DEFAULT 'ok',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO data_sync_status (id) VALUES ('stripe'), ('mercury'), ('gcp-billing')
ON CONFLICT (id) DO NOTHING;

-- System incidents
CREATE TABLE IF NOT EXISTS incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  affected_agents TEXT[],
  status TEXT DEFAULT 'open',
  root_cause TEXT,
  resolution TEXT,
  created_by TEXT DEFAULT 'atlas',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

-- System status snapshots (Atlas writes, Sarah reads)
CREATE TABLE IF NOT EXISTS system_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL,
  summary TEXT NOT NULL,
  details TEXT,
  agent_health JSONB,
  data_freshness JSONB,
  cost_anomalies JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert Atlas into company_agents
INSERT INTO company_agents (id, role, codename, status, model, department, tier)
VALUES ('ops', 'ops', 'Atlas Vega', 'active', 'gemini-3-flash-preview', 'Operations', 'green')
ON CONFLICT (id) DO NOTHING;
