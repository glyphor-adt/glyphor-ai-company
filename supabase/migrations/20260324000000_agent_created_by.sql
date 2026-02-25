-- Add created_by column to company_agents for tracking which executive created a specialist agent
ALTER TABLE company_agents ADD COLUMN IF NOT EXISTS created_by TEXT;
