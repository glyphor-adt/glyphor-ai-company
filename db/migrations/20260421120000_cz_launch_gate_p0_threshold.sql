-- Adjust launch gate thresholds and introduce a numeric P0 pass-rate threshold.
--
-- Previously cz_launch_gates only had p0_must_be_100 (boolean), which forced
-- every gate to require 100% P0 pass. Product wants to relax design_partner_ready
-- to "P0 at 90%; overall pass >=70%; no orch delta worse than -1.0".
--
-- Add p0_pass_rate_min (NUMERIC) so gates can express partial P0 thresholds.
-- p0_must_be_100 is retained for backward compatibility but is no longer the
-- source of truth when p0_pass_rate_min is set.

ALTER TABLE cz_launch_gates
    ADD COLUMN IF NOT EXISTS p0_pass_rate_min NUMERIC(4,3);

-- Backfill: existing gates that required 100% map to 1.000; relax design_partner.
UPDATE cz_launch_gates
   SET p0_pass_rate_min = 1.000
 WHERE p0_pass_rate_min IS NULL
   AND p0_must_be_100 = TRUE;

UPDATE cz_launch_gates
   SET p0_pass_rate_min     = 0.900,
       overall_pass_rate_min = 0.700,
       max_neg_orch_delta    = -1.00,
       description           = 'P0 at 90%; overall pass ≥70%; no orch delta worse than -1.0'
 WHERE gate = 'design_partner_ready';

-- Investor / public launch keep 100% P0 but make the new column explicit.
UPDATE cz_launch_gates
   SET p0_pass_rate_min = 1.000
 WHERE gate IN ('investor_ready', 'public_launch_ready');
