-- C.8: Deactivate orphan DB-only agents with no runner code and no active assignments
-- Per fleet audit: ethan has no runner, no recent meaningful activity, and no team allocation.
-- The remaining DB-only agents (adi-rose, bob-the-tax-pro, marketing-intelligence-analyst)
-- are deferred — they have build_runner recommendations pending orchestration decisions.

-- Deactivate ethan (no runner, no team, diagnostic artifact)
UPDATE company_agents SET status = 'inactive' WHERE role = 'ethan' AND status = 'active';

-- Clean up skill assignments for deactivated agents
DELETE FROM agent_skills WHERE agent_role = 'ethan';

-- Verify the previously planned deactivations are already done
-- (onboarding-specialist, support-triage, vp-customer-success, tax-strategy-specialist,
--  lead-gen-specialist, org-analyst were expected but not found as active — likely
--  already deactivated or removed in prior cleanups)
