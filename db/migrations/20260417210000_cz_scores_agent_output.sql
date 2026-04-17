-- Add agent_output column to store actual agent responses for cert test visibility
-- Also expand judge_tier to support 'llm-judge' and 'error' tiers
-- -----------------------------------------------------------------------------

ALTER TABLE cz_scores ADD COLUMN IF NOT EXISTS agent_output TEXT;

-- Drop and re-add the check constraint to allow new judge tiers
ALTER TABLE cz_scores DROP CONSTRAINT IF EXISTS cz_scores_judge_tier_check;
ALTER TABLE cz_scores ADD CONSTRAINT cz_scores_judge_tier_check
  CHECK (judge_tier IN ('heuristic', 'flash_lite', 'triangulated', 'llm-judge', 'error'));
