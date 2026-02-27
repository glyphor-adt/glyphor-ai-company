-- Add last_run_summary to company_agents for working memory between runs.
ALTER TABLE company_agents ADD COLUMN IF NOT EXISTS last_run_summary TEXT;
