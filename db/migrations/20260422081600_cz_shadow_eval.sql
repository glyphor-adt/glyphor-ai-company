-- Shadow-eval state for auto-promotion of CZ reflection challengers.
--
-- Lifecycle of a challenger prompt:
--   staged (source='cz_reflection' or 'reflection', deployed_at NULL, retired_at NULL)
--     → shadow_pending  (canary run queued against baseline's failing tasks)
--     → shadow_running  (canary in flight)
--     → shadow_passed   (challenger beat baseline by promotion_margin on N consecutive canaries)
--         → auto-promoted (deployed_at set, retired_at set on old baseline, source='shadow_promoted')
--     → shadow_failed   (challenger did NOT beat baseline after max_attempts canaries)
--         → retired_at set, source unchanged so it stays visible in history
--     → human_review    (stuck — same heuristic firing repeatedly; escalated to a human queue)
--
-- We store shadow state on a separate table keyed by prompt_version_id so we
-- don't widen agent_prompt_versions with columns that are only meaningful for
-- CZ-originated mutations.

CREATE TABLE IF NOT EXISTS cz_shadow_evals (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_version_id UUID NOT NULL REFERENCES agent_prompt_versions(id) ON DELETE CASCADE,
  agent_id         TEXT NOT NULL,
  tenant_id        TEXT NOT NULL,

  -- The tasks we're evaluating the challenger against. Locked in at creation
  -- so we compare apples-to-apples across attempts even if other tasks for
  -- the agent start failing mid-evaluation.
  target_task_ids  UUID[] NOT NULL,

  -- Promotion gate: challenger must beat baseline by this many points of
  -- pass rate (0-1 scale) on its target_task_ids across required_wins
  -- consecutive canary runs. Defaults chosen to match the original architecture
  -- note: +20 points, 2 consecutive, max 3 attempts.
  promotion_margin NUMERIC(4,3) NOT NULL DEFAULT 0.20,
  required_wins    INT           NOT NULL DEFAULT 2,
  max_attempts     INT           NOT NULL DEFAULT 3,

  -- Rolling state
  state            TEXT NOT NULL DEFAULT 'shadow_pending'
    CHECK (state IN ('shadow_pending','shadow_running','shadow_passed','shadow_failed','human_review','auto_promoted')),
  consecutive_wins INT  NOT NULL DEFAULT 0,
  attempts_used    INT  NOT NULL DEFAULT 0,

  -- Baseline snapshot at eval creation — what the challenger needs to beat.
  baseline_pass_rate NUMERIC(4,3),
  baseline_avg_score NUMERIC(4,2),

  -- Latest canary outcome (for UI; full history is in cz_shadow_attempts)
  last_pass_rate   NUMERIC(4,3),
  last_avg_score   NUMERIC(4,2),
  last_batch_id    UUID,
  last_ran_at      TIMESTAMPTZ,

  -- Escalation trail
  escalation_reason TEXT,
  escalated_at      TIMESTAMPTZ,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One active shadow-eval per prompt version. If you want to re-try, retire
  -- the old one first.
  UNIQUE (prompt_version_id)
);

CREATE INDEX IF NOT EXISTS idx_cz_shadow_evals_state ON cz_shadow_evals (state)
  WHERE state IN ('shadow_pending','shadow_running');
CREATE INDEX IF NOT EXISTS idx_cz_shadow_evals_agent ON cz_shadow_evals (agent_id, state);

-- Per-attempt history — one row per canary run this shadow-eval triggered.
-- Lets us show the promotion curve in the dashboard and debug why a
-- challenger failed.
CREATE TABLE IF NOT EXISTS cz_shadow_attempts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shadow_eval_id   UUID NOT NULL REFERENCES cz_shadow_evals(id) ON DELETE CASCADE,
  attempt_number   INT NOT NULL,
  batch_id         UUID NOT NULL,

  challenger_pass_rate NUMERIC(4,3),
  challenger_avg_score NUMERIC(4,2),
  delta_vs_baseline    NUMERIC(4,3),  -- challenger - baseline, signed
  was_win              BOOLEAN NOT NULL DEFAULT FALSE,

  -- Snapshot of which heuristics fired in this attempt so we can detect the
  -- "same tag, no improvement" escalation pattern without re-querying scores.
  heuristic_tags_seen TEXT[],

  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at     TIMESTAMPTZ,

  UNIQUE (shadow_eval_id, attempt_number)
);

CREATE INDEX IF NOT EXISTS idx_cz_shadow_attempts_eval ON cz_shadow_attempts (shadow_eval_id, attempt_number);

-- Extend cz_runs with a nullable prompt_version_id so an executor run can
-- use a specific challenger prompt instead of the agent's current live
-- deployment. When NULL, behavior is unchanged (current deployed prompt).
ALTER TABLE cz_runs ADD COLUMN IF NOT EXISTS prompt_version_id UUID
  REFERENCES agent_prompt_versions(id);

-- Triggered_by convention for auto-runs so the dashboard can distinguish them:
--   'auto:scheduler'        — cron-driven full/critical runs
--   'auto:shadow-eval'      — canary runs kicked off by shadow-eval
--   'auto:orchestrator'     — Sarah's cz_protocol_loop
--   'dashboard:*'           — human-initiated from the UI
-- (no schema change needed; just a naming convention for triggered_by)

-- Config table for the automation loop itself. Single-row, key-value
-- convenience table so you can pause automation without redeploying.
CREATE TABLE IF NOT EXISTS cz_automation_config (
  key              TEXT PRIMARY KEY,
  value_json       JSONB NOT NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by       TEXT
);

INSERT INTO cz_automation_config (key, value_json, updated_by) VALUES
  ('loop_enabled',              'true'::jsonb,                         'migration'),
  ('critical_run_interval_min', '30'::jsonb,                           'migration'),
  ('full_run_cron',             '"0 4 * * *"'::jsonb,                  'migration'),
  ('shadow_eval_enabled',       'true'::jsonb,                         'migration'),
  ('auto_reassign_enabled',     'true'::jsonb,                         'migration'),
  ('stuck_threshold_attempts',  '5'::jsonb,                            'migration'),
  ('slack_escalation_channel',  '"#cz-automation"'::jsonb,             'migration')
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE cz_shadow_evals IS 'Auto-promotion gate for CZ reflection-generated prompt mutations.';
COMMENT ON TABLE cz_shadow_attempts IS 'Per-canary-run history for a shadow eval. Drives promotion-curve UI and escalation detection.';
COMMENT ON TABLE cz_automation_config IS 'Runtime flags for the CZ automation loop. Edit here to pause without redeploying.';
