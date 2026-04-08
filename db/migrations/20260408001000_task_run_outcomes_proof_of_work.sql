-- Add proof_of_work and evidence_tier to task_run_outcomes
--
-- proof_of_work: structured snapshot captured at harvest time.
--   { output_length, tool_calls_succeeded, tool_calls_failed, has_meaningful_output }
--   Lets the ops dashboard surface CLAIM_WITHOUT_EVIDENCE rows without joining 3 tables.
--
-- evidence_tier: honest classification of how much runtime proof backs the completion claim.
--   proven           — submitted + meaningful output (>=100 chars) + multiple successful tool calls
--   partially_proven — submitted + meaningful output OR non-trivial tool work, not both
--   self_reported    — agent claimed completion but output was trivially short (downgraded from submitted)
--   inconsistent     — majority of tool calls failed despite claimed success

ALTER TABLE task_run_outcomes
  ADD COLUMN IF NOT EXISTS proof_of_work   JSONB,
  ADD COLUMN IF NOT EXISTS evidence_tier   TEXT
    CHECK (evidence_tier IN ('proven', 'partially_proven', 'self_reported', 'inconsistent'));
