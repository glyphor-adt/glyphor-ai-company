-- Reassign Identity & Tenancy CZ tasks from sarah (chief-of-staff) to
-- marcus (cto). These tasks verify cross-tenant leakage, cross-workspace
-- isolation, and federation-level prompt injection hardening — infra
-- concerns that belong to the CTO's scope, not to an executive orchestration
-- role. Sarah consistently drifted to adjacent Slack Connect communications
-- policy when handed these tasks (see task #68 fix brief, 2026-04-21).
--
-- Related runtime changes in the same deploy:
--   * CZ executor prompt: INFRASTRUCTURE VERIFICATION clause instructs the
--     owning agent to enumerate all N invocations inline under
--     "### Simulated verification rig" (tenant/federation/RLS harness tests
--     cannot run for real from a chat completion).
--   * CZ heuristic: `infra_verification_skipped` fires when the verification
--     method describes a test rig / N federated invocations and the output
--     has no per-invocation enumeration.
--
-- Task #70 (guest user handling) was already assigned to marcus and is not
-- touched by this migration.

UPDATE cz_tasks
   SET responsible_agent = 'marcus',
       updated_at = NOW()
 WHERE task_number IN (68, 69, 71, 72)
   AND responsible_agent = 'sarah';
