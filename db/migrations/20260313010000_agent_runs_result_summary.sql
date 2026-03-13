ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS result_summary TEXT;
