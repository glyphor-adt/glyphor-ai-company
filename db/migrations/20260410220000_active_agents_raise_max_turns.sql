BEGIN;

-- Align company_agents.max_turns with packages/agents reactive turn floor (28) for all
-- active roster agents. Runtime code already applies the same floor; this keeps DB,
-- dashboards, and dynamic-agent loadAgentConfig defaults honest. Never lowers a value.

UPDATE company_agents
SET
  max_turns = GREATEST(COALESCE(max_turns, 10), 28),
  updated_at = NOW()
WHERE status = 'active';

COMMIT;
