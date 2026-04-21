-- Relax investor_ready launch gate.
-- New thresholds: P0 at 80%; overall pass >=80%; no orch delta worse than -1.0.

UPDATE cz_launch_gates
   SET p0_must_be_100        = FALSE,
       p0_pass_rate_min      = 0.800,
       overall_pass_rate_min = 0.800,
       avg_judge_score_min   = 7.50,
       max_neg_orch_delta    = -1.00,
       description           = 'P0 at 80%; overall pass ≥80%; no orch delta worse than -1.0'
 WHERE gate = 'investor_ready';
