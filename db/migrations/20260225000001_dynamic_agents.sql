-- Dynamic agent management tables

-- Dynamic agent briefs (for agents created via dashboard)
CREATE TABLE IF NOT EXISTS agent_briefs (
  agent_id TEXT PRIMARY KEY,
  system_prompt TEXT,
  skills TEXT[],
  tools TEXT[],
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Dynamic schedules (for agents created via dashboard)
CREATE TABLE IF NOT EXISTS agent_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL,
  cron_expression TEXT NOT NULL,
  task TEXT NOT NULL DEFAULT 'scheduled_run',
  enabled BOOLEAN DEFAULT true,
  last_triggered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add columns to company_agents if not present
ALTER TABLE company_agents ADD COLUMN IF NOT EXISTS model TEXT DEFAULT 'gpt-5-mini-2025-08-07';
ALTER TABLE company_agents ADD COLUMN IF NOT EXISTS temperature DECIMAL(3,2) DEFAULT 0.3;
ALTER TABLE company_agents ADD COLUMN IF NOT EXISTS max_turns INT DEFAULT 10;
ALTER TABLE company_agents ADD COLUMN IF NOT EXISTS budget_per_run DECIMAL(10,4) DEFAULT 0.05;
ALTER TABLE company_agents ADD COLUMN IF NOT EXISTS budget_daily DECIMAL(10,4) DEFAULT 0.50;
ALTER TABLE company_agents ADD COLUMN IF NOT EXISTS budget_monthly DECIMAL(10,4) DEFAULT 15.00;
ALTER TABLE company_agents ADD COLUMN IF NOT EXISTS is_temporary BOOLEAN DEFAULT false;
ALTER TABLE company_agents ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE company_agents ADD COLUMN IF NOT EXISTS is_core BOOLEAN DEFAULT false;
ALTER TABLE company_agents ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE company_agents ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE company_agents ADD COLUMN IF NOT EXISTS title TEXT DEFAULT '';
ALTER TABLE company_agents ADD COLUMN IF NOT EXISTS reports_to TEXT;
