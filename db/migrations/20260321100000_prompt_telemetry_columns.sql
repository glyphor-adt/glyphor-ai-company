-- Add prompt telemetry columns to agent_runs for system prompt decomposition tracking.
-- These columns record which components were assembled into the system prompt and the
-- estimated token count, enabling cost analysis and prompt size regression detection.

ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS prompt_components TEXT[],
  ADD COLUMN IF NOT EXISTS prompt_token_estimate INTEGER;

COMMENT ON COLUMN agent_runs.prompt_components IS 'List of component names included in the assembled system prompt (e.g. kb, doctrine, behavioral_rules, role_prompt, skill:xyz)';
COMMENT ON COLUMN agent_runs.prompt_token_estimate IS 'Estimated token count of the assembled system prompt (chars / 4)';
