-- Glyphor Company Memory — Supabase Schema Migration
-- Run this in Supabase SQL Editor to set up all tables

-- Core company context
CREATE TABLE IF NOT EXISTS company_profile (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,
  value JSONB NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  version INT DEFAULT 1
);

-- Product portfolio
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  roadmap JSONB DEFAULT '[]',
  metrics JSONB DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Agent roster and governance
CREATE TABLE IF NOT EXISTS company_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  schedule_cron TEXT,
  last_run_at TIMESTAMPTZ,
  last_run_duration_ms INT,
  last_run_cost_usd DECIMAL(10,4),
  performance_score DECIMAL(3,2),
  total_runs INT DEFAULT 0,
  total_cost_usd DECIMAL(10,2) DEFAULT 0,
  config JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Decision queue
CREATE TABLE IF NOT EXISTS decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tier TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  proposed_by TEXT NOT NULL,
  reasoning TEXT NOT NULL,
  data JSONB,
  assigned_to TEXT[],
  resolved_by TEXT,
  resolution_note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

-- Activity log
CREATE TABLE IF NOT EXISTS activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_role TEXT NOT NULL,
  action TEXT NOT NULL,
  product TEXT,
  summary TEXT NOT NULL,
  details JSONB,
  tier TEXT DEFAULT 'green',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Competitive intelligence
CREATE TABLE IF NOT EXISTS competitive_intel (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competitor TEXT NOT NULL,
  category TEXT NOT NULL,
  summary TEXT NOT NULL,
  source_url TEXT,
  relevance TEXT,
  action_recommended TEXT,
  detected_at TIMESTAMPTZ DEFAULT NOW()
);

-- Customer health
CREATE TABLE IF NOT EXISTS customer_health (
  user_id UUID NOT NULL,
  product TEXT NOT NULL,
  health_score DECIMAL(3,2),
  builds_last_7d INT,
  builds_last_30d INT,
  quality_avg DECIMAL(3,2),
  last_active_at TIMESTAMPTZ,
  churn_risk TEXT,
  segment TEXT,
  notes TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, product)
);

-- Financial tracking
CREATE TABLE IF NOT EXISTS financials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  product TEXT,
  metric TEXT NOT NULL,
  value DECIMAL(12,2) NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Product proposals
CREATE TABLE IF NOT EXISTS product_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codename TEXT NOT NULL,
  proposed_by TEXT NOT NULL,
  status TEXT DEFAULT 'draft',
  description TEXT NOT NULL,
  target_market TEXT,
  tam_estimate JSONB,
  financial_model JSONB,
  technical_feasibility JSONB,
  competitive_landscape JSONB,
  decision_id UUID REFERENCES decisions(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON activity_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_agent_role ON activity_log(agent_role);
CREATE INDEX IF NOT EXISTS idx_decisions_status ON decisions(status);
CREATE INDEX IF NOT EXISTS idx_decisions_tier ON decisions(tier);
CREATE INDEX IF NOT EXISTS idx_financials_date ON financials(date DESC);
CREATE INDEX IF NOT EXISTS idx_customer_health_churn ON customer_health(churn_risk);
CREATE INDEX IF NOT EXISTS idx_competitive_intel_detected ON competitive_intel(detected_at DESC);

-- RPC for atomically recording agent runs
CREATE OR REPLACE FUNCTION record_agent_run(
  p_role TEXT,
  p_duration_ms INT,
  p_cost_usd DECIMAL(10,4)
) RETURNS VOID AS $$
BEGIN
  UPDATE company_agents
  SET
    last_run_at = NOW(),
    last_run_duration_ms = p_duration_ms,
    last_run_cost_usd = p_cost_usd,
    total_runs = total_runs + 1,
    total_cost_usd = total_cost_usd + p_cost_usd
  WHERE role = p_role;
END;
$$ LANGUAGE plpgsql;
