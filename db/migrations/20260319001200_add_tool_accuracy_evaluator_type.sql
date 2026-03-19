-- Extend evaluator_type CHECK constraint to include 'tool_accuracy'.
-- Required before the tool accuracy evaluator can write to assignment_evaluations.

ALTER TABLE assignment_evaluations
  DROP CONSTRAINT IF EXISTS assignment_evaluations_evaluator_type_check;

ALTER TABLE assignment_evaluations
  ADD CONSTRAINT assignment_evaluations_evaluator_type_check
  CHECK (evaluator_type IN ('cos', 'executive', 'team', 'judge', 'constitutional', 'tool_accuracy'));
