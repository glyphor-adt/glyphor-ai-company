-- Add thinking_enabled column to company_agents
-- Controls whether extended thinking / reasoning mode is used during LLM calls
ALTER TABLE company_agents
  ADD COLUMN IF NOT EXISTS thinking_enabled boolean DEFAULT true;
