-- Add 'framework-analysis' to the strategy_analyses status check constraint.
-- Required by the hybrid Strategy Lab pipeline (DR → synthesis → frameworks → complete).

ALTER TABLE strategy_analyses DROP CONSTRAINT IF EXISTS strategy_analyses_status_check;
ALTER TABLE strategy_analyses ADD CONSTRAINT strategy_analyses_status_check CHECK (
  status IN ('planning', 'framing', 'decomposing', 'researching', 'quality-check', 'analyzing', 'framework-analysis', 'synthesizing', 'deepening', 'completed', 'failed')
);
