-- Reliability Canary Validation Bundle
-- Run against staging/canary DB after canary traffic.
-- All checks return PASS/FAIL with diagnostic values.

-- =============================================================================
-- 1) Schema Presence
-- =============================================================================
WITH required_tables AS (
  SELECT unnest(ARRAY[
    'agent_run_events',
    'agent_run_evidence',
    'agent_claim_evidence_links',
    'agent_failure_taxonomy'
  ]) AS table_name
),
present AS (
  SELECT table_name
  FROM information_schema.tables
  WHERE table_schema = 'public'
)
SELECT
  'schema_presence' AS check_name,
  CASE WHEN COUNT(*) = (SELECT COUNT(*) FROM required_tables) THEN 'PASS' ELSE 'FAIL' END AS status,
  COUNT(*) AS present_count,
  (SELECT COUNT(*) FROM required_tables) AS required_count
FROM required_tables r
JOIN present p ON p.table_name = r.table_name;

-- =============================================================================
-- 2) Run Replay Coverage (24h)
-- =============================================================================
WITH completed_runs AS (
  SELECT id
  FROM agent_runs
  WHERE completed_at > NOW() - INTERVAL '24 hours'
    AND status = 'completed'
),
event_coverage AS (
  SELECT
    r.id,
    BOOL_OR(e.event_type = 'run.started') AS has_start,
    BOOL_OR(e.event_type IN ('run.completed', 'run.failed')) AS has_terminal
  FROM completed_runs r
  LEFT JOIN agent_run_events e ON e.run_id = r.id
  GROUP BY r.id
)
SELECT
  'replay_coverage_24h' AS check_name,
  CASE
    WHEN COUNT(*) = 0 THEN 'PASS'
    WHEN (AVG(CASE WHEN has_start AND has_terminal THEN 1.0 ELSE 0.0 END) >= 0.95) THEN 'PASS'
    ELSE 'FAIL'
  END AS status,
  ROUND(100.0 * AVG(CASE WHEN has_start AND has_terminal THEN 1.0 ELSE 0.0 END), 2) AS coverage_pct,
  COUNT(*) AS completed_runs_24h
FROM event_coverage;

-- =============================================================================
-- 3) Event Sequence Monotonicity
-- =============================================================================
WITH seq_gaps AS (
  SELECT
    run_id,
    event_seq,
    LAG(event_seq) OVER (PARTITION BY run_id ORDER BY event_seq) AS prev_seq
  FROM agent_run_events
  WHERE created_at > NOW() - INTERVAL '24 hours'
)
SELECT
  'event_sequence_monotonicity_24h' AS check_name,
  CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
  COUNT(*) AS violation_count
FROM seq_gaps
WHERE prev_seq IS NOT NULL
  AND event_seq <= prev_seq;

-- =============================================================================
-- 4) Digest Chain Consistency
-- =============================================================================
WITH ordered AS (
  SELECT
    run_id,
    event_seq,
    prev_event_digest,
    LAG(event_digest) OVER (PARTITION BY run_id ORDER BY event_seq) AS expected_prev_digest
  FROM agent_run_events
  WHERE created_at > NOW() - INTERVAL '24 hours'
),
violations AS (
  SELECT *
  FROM ordered
  WHERE event_seq > 1
    AND COALESCE(prev_event_digest, '') <> COALESCE(expected_prev_digest, '')
)
SELECT
  'digest_chain_consistency_24h' AS check_name,
  CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
  COUNT(*) AS mismatch_count
FROM violations;

-- =============================================================================
-- 5) Claim -> Evidence Referential Integrity
-- =============================================================================
SELECT
  'claim_evidence_integrity_24h' AS check_name,
  CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
  COUNT(*) AS orphaned_links
FROM agent_claim_evidence_links l
LEFT JOIN agent_run_evidence e ON e.evidence_uid = l.evidence_uid
WHERE l.created_at > NOW() - INTERVAL '24 hours'
  AND e.evidence_uid IS NULL;

-- =============================================================================
-- 6) Unsupported Claim Rate
-- =============================================================================
SELECT
  'unsupported_claim_rate_24h' AS check_name,
  CASE
    WHEN COUNT(*) = 0 THEN 'PASS'
    WHEN (SUM(CASE WHEN verification_state = 'unsupported' THEN 1 ELSE 0 END)::numeric / COUNT(*)) <= 0.10 THEN 'PASS'
    ELSE 'FAIL'
  END AS status,
  ROUND(
    100.0 * SUM(CASE WHEN verification_state = 'unsupported' THEN 1 ELSE 0 END)::numeric
    / NULLIF(COUNT(*), 0),
    2
  ) AS unsupported_pct,
  COUNT(*) AS total_claim_links
FROM agent_claim_evidence_links
WHERE created_at > NOW() - INTERVAL '24 hours';

-- =============================================================================
-- 7) High-Stakes Verification Coverage (includes contradiction scan)
-- =============================================================================
WITH high_stakes AS (
  SELECT id, verification_tier, verification_passes
  FROM agent_runs
  WHERE completed_at > NOW() - INTERVAL '24 hours'
    AND task IN ('orchestrate', 'pipeline_review')
),
evaluated AS (
  SELECT
    id,
    verification_tier,
    verification_passes,
    CASE
      WHEN verification_tier IN ('cross_model', 'conditional')
       AND verification_passes IS NOT NULL
       AND 'cross_model' = ANY(verification_passes)
       AND 'contradiction_scan' = ANY(verification_passes)
      THEN 1 ELSE 0
    END AS covered
  FROM high_stakes
)
SELECT
  'high_stakes_verification_coverage_24h' AS check_name,
  CASE
    WHEN COUNT(*) = 0 THEN 'PASS'
    WHEN AVG(covered::numeric) >= 1.0 THEN 'PASS'
    ELSE 'FAIL'
  END AS status,
  ROUND(100.0 * AVG(covered::numeric), 2) AS coverage_pct,
  COUNT(*) AS high_stakes_runs
FROM evaluated;

-- =============================================================================
-- 8) Value Gate Block Rate (diagnostic threshold <= 35%)
-- =============================================================================
WITH high_impact_requests AS (
  SELECT run_id, COUNT(*) AS request_count
  FROM agent_run_events
  WHERE created_at > NOW() - INTERVAL '24 hours'
    AND event_type = 'tool.requested'
  GROUP BY run_id
),
blocked AS (
  SELECT run_id, COUNT(*) AS blocked_count
  FROM agent_run_events
  WHERE created_at > NOW() - INTERVAL '24 hours'
    AND event_type = 'tool.blocked'
    AND trigger = 'pre_execution_value_gate'
  GROUP BY run_id
)
SELECT
  'value_gate_block_rate_24h' AS check_name,
  CASE
    WHEN COALESCE(SUM(h.request_count), 0) = 0 THEN 'PASS'
    WHEN (COALESCE(SUM(b.blocked_count), 0)::numeric / NULLIF(SUM(h.request_count), 0)) <= 0.35 THEN 'PASS'
    ELSE 'FAIL'
  END AS status,
  ROUND(
    100.0 * COALESCE(SUM(b.blocked_count), 0)::numeric / NULLIF(SUM(h.request_count), 0),
    2
  ) AS block_rate_pct,
  COALESCE(SUM(b.blocked_count), 0) AS blocked_count,
  COALESCE(SUM(h.request_count), 0) AS request_count
FROM high_impact_requests h
LEFT JOIN blocked b ON b.run_id = h.run_id;

-- =============================================================================
-- 9) Failure Taxonomy Presence
-- =============================================================================
SELECT
  'failure_taxonomy_population_24h' AS check_name,
  CASE WHEN COUNT(*) > 0 THEN 'PASS' ELSE 'WARN' END AS status,
  COUNT(*) AS taxonomy_rows_24h
FROM agent_failure_taxonomy
WHERE created_at > NOW() - INTERVAL '24 hours';

-- =============================================================================
-- 10) Top Failure Codes (diagnostic)
-- =============================================================================
SELECT
  failure_code,
  severity,
  COUNT(*) AS count_24h
FROM agent_failure_taxonomy
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY failure_code, severity
ORDER BY count_24h DESC, failure_code;
