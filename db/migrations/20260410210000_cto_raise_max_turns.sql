BEGIN;

-- CTO (OrchestratorRunner) runs work_loop / urgent_message_response with many tool
-- rounds; low max_turns caused max_turns_exceeded before Marcus could finish inbox work.
-- Floor at 28; do not reduce rows that already exceed this.

UPDATE company_agents
SET
  max_turns = GREATEST(COALESCE(max_turns, 10), 28),
  updated_at = NOW()
WHERE role = 'cto';

COMMIT;
