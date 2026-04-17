-- Customer Zero Protocol schema
-- Adds 3 tables + 2 config tables to existing Glyphor Cloud SQL Postgres
-- pgcrypto already enabled in this database

-- -----------------------------------------------------------------------------
-- cz_tasks — the protocol. Source of truth for what gets tested.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cz_tasks (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_number           INT UNIQUE NOT NULL,
    pillar                TEXT NOT NULL,
    sub_category          TEXT NOT NULL,
    task                  TEXT NOT NULL,
    acceptance_criteria   TEXT NOT NULL,
    verification_method   TEXT NOT NULL,
    responsible_agent     TEXT,
    is_p0                 BOOLEAN NOT NULL DEFAULT FALSE,
    active                BOOLEAN NOT NULL DEFAULT TRUE,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by            TEXT,
    tags                  TEXT[] DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_cz_tasks_pillar  ON cz_tasks(pillar)  WHERE active;
CREATE INDEX IF NOT EXISTS idx_cz_tasks_p0      ON cz_tasks(is_p0)   WHERE active;
CREATE INDEX IF NOT EXISTS idx_cz_tasks_agent   ON cz_tasks(responsible_agent) WHERE active;

-- -----------------------------------------------------------------------------
-- cz_runs — every execution. One row per task-mode combination per run batch.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cz_runs (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id              UUID NOT NULL,
    task_id               UUID NOT NULL REFERENCES cz_tasks(id),
    mode                  TEXT NOT NULL CHECK (mode IN ('solo','orchestrated')),
    trigger_type          TEXT NOT NULL CHECK (trigger_type IN ('single','pillar','critical','full','canary','manual')),
    triggered_by          TEXT,
    status                TEXT NOT NULL DEFAULT 'queued'
                          CHECK (status IN ('queued','running','scored','failed','cancelled')),
    started_at            TIMESTAMPTZ,
    completed_at          TIMESTAMPTZ,
    agent_chain           TEXT[],
    raw_output            TEXT,
    tool_calls            JSONB DEFAULT '[]',
    latency_ms            INT,
    tokens_in             INT,
    tokens_out            INT,
    cost_usd              NUMERIC(10,6),
    error_message         TEXT
);

CREATE INDEX IF NOT EXISTS idx_cz_runs_task     ON cz_runs(task_id);
CREATE INDEX IF NOT EXISTS idx_cz_runs_batch    ON cz_runs(batch_id);
CREATE INDEX IF NOT EXISTS idx_cz_runs_status   ON cz_runs(status);
CREATE INDEX IF NOT EXISTS idx_cz_runs_started  ON cz_runs(started_at DESC);

-- -----------------------------------------------------------------------------
-- cz_scores — judge results. One row per cz_run.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cz_scores (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id                UUID NOT NULL UNIQUE REFERENCES cz_runs(id) ON DELETE CASCADE,
    passed                BOOLEAN NOT NULL,
    judge_score           NUMERIC(4,2),
    judge_tier            TEXT NOT NULL CHECK (judge_tier IN ('heuristic','flash_lite','triangulated')),
    heuristic_failures    TEXT[] DEFAULT '{}',
    validator_scores      JSONB DEFAULT '{}',
    validator_disagreement NUMERIC(4,2),
    judge_model           TEXT,
    reasoning_trace       TEXT,
    axis_scores           JSONB DEFAULT '{}',
    flagged_for_review    BOOLEAN DEFAULT FALSE,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cz_scores_run    ON cz_scores(run_id);
CREATE INDEX IF NOT EXISTS idx_cz_scores_passed ON cz_scores(passed);
CREATE INDEX IF NOT EXISTS idx_cz_scores_flagged ON cz_scores(flagged_for_review) WHERE flagged_for_review;

-- -----------------------------------------------------------------------------
-- cz_pillar_config — thresholds for pass/fail and dashboard color coding
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cz_pillar_config (
    pillar                TEXT PRIMARY KEY,
    display_order         INT NOT NULL,
    pass_rate_threshold   NUMERIC(4,3) NOT NULL,
    avg_score_threshold   NUMERIC(4,2) NOT NULL,
    is_p0                 BOOLEAN NOT NULL DEFAULT FALSE,
    description           TEXT
);

-- -----------------------------------------------------------------------------
-- cz_launch_gates — the three go/no-go thresholds
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cz_launch_gates (
    gate                  TEXT PRIMARY KEY,
    display_order         INT NOT NULL,
    p0_must_be_100        BOOLEAN NOT NULL DEFAULT TRUE,
    overall_pass_rate_min NUMERIC(4,3) NOT NULL,
    avg_judge_score_min   NUMERIC(4,2) NOT NULL,
    max_neg_orch_delta    NUMERIC(4,2),
    description           TEXT
);

-- -----------------------------------------------------------------------------
-- Convenience view: latest score per task per mode
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW cz_latest_scores AS
SELECT DISTINCT ON (r.task_id, r.mode)
    r.task_id,
    r.mode,
    r.id AS run_id,
    r.completed_at,
    s.passed,
    s.judge_score,
    s.judge_tier,
    s.flagged_for_review
FROM cz_runs r
JOIN cz_scores s ON s.run_id = r.id
WHERE r.status = 'scored'
ORDER BY r.task_id, r.mode, r.completed_at DESC;

-- RLS policies (match existing system_bypass pattern)
ALTER TABLE cz_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE cz_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE cz_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE cz_pillar_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE cz_launch_gates ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY system_bypass ON cz_tasks FOR ALL TO glyphor_system USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY system_bypass ON cz_runs FOR ALL TO glyphor_system USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY system_bypass ON cz_scores FOR ALL TO glyphor_system USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY system_bypass ON cz_pillar_config FOR ALL TO glyphor_system USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY system_bypass ON cz_launch_gates FOR ALL TO glyphor_system USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
