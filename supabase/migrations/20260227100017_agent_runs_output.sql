-- Add output column to agent_runs so we can see what agents actually worked on
ALTER TABLE IF EXISTS agent_runs
  ADD COLUMN IF NOT EXISTS output TEXT;

-- Also add an input/message column so we know what prompt triggered the run
ALTER TABLE IF EXISTS agent_runs
  ADD COLUMN IF NOT EXISTS input TEXT;
