const { Client } = require('pg');
const c = new Client({
  connectionString: 'postgresql://glyphor_system_user:a7JwuQFobpCzZI+JWyPhCSheZFvIt2OA0rjt9FJvtJ4CaagtOM9p72mdTCM5IHzN@127.0.0.1:6543/glyphor'
});

async function main() {
  await c.connect();
  
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const agentRole = 'cto';
  
  console.log('since =', since);
  
  // Set role like systemQuery does
  await c.query('SET ROLE glyphor_system').catch(() => {});
  
  // Query 1: trust scores
  console.log('1. trust...');
  const t = await c.query('SELECT trust_score, score_history FROM agent_trust_scores WHERE agent_role = $1 LIMIT 1', [agentRole]);
  console.log('  OK:', t.rows[0]?.trust_score);

  // Query 2: loadRunMetrics
  console.log('2. runMetrics...');
  try {
    const r = await c.query(`
      SELECT
        COUNT(*)::int AS total_runs,
        COUNT(*) FILTER (WHERE status IN ('completed', 'failed', 'aborted', 'skipped_precheck'))::int AS terminal_runs,
        COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_runs,
        AVG(reasoning_confidence) FILTER (WHERE reasoning_confidence IS NOT NULL)::double precision AS avg_confidence_score
      FROM agent_runs
      WHERE agent_id = $1
        AND started_at >= $2::timestamptz
    `, [agentRole, since]);
    console.log('  OK:', r.rows[0]);
  } catch(e) {
    console.log('  ERROR:', e.message);
  }

  // Query 3: loadOutcomeMetrics
  console.log('3. outcomeMetrics...');
  try {
    const o = await c.query(`
      SELECT
        COUNT(*)::int AS total_outcomes,
        COUNT(*) FILTER (WHERE final_status = 'submitted')::int AS completed_outcomes,
        COUNT(*) FILTER (WHERE final_status IN ('flagged_blocker', 'partial_progress', 'aborted'))::int AS escalated_outcomes
      FROM task_run_outcomes
      WHERE agent_role = $1
        AND created_at >= $2::timestamptz
    `, [agentRole, since]);
    console.log('  OK:', o.rows[0]);
  } catch(e) {
    console.log('  ERROR:', e.message);
  }

  // Query 4: contradictions (safeCount)
  console.log('4. contradictions...');
  try {
    const cc = await c.query(`
      SELECT COUNT(*)::int AS count
      FROM kg_contradictions
      WHERE detected_at >= $2::timestamptz
        AND ($1 = fact_a_agent_id OR $1 = fact_b_agent_id)
    `, [agentRole, since]);
    console.log('  OK:', cc.rows[0]);
  } catch(e) {
    console.log('  ERROR:', e.message);
  }

  // Query 5: SLA
  console.log('5. SLA...');
  try {
    const s = await c.query(`
      SELECT
        COUNT(*)::int AS total_contracts,
        COUNT(*) FILTER (WHERE sla_breached_at IS NOT NULL)::int AS breached_contracts
      FROM agent_handoff_contracts
      WHERE receiving_agent_id = $1
        AND issued_at >= $2::timestamptz
    `, [agentRole, since]);
    console.log('  OK:', s.rows[0]);
  } catch(e) {
    console.log('  ERROR:', e.message);
  }

  // Query 6: lifetime
  console.log('6. lifetime...');
  try {
    const l = await c.query(`
      SELECT COUNT(*) FILTER (WHERE status = 'completed')::int AS count
      FROM agent_runs
      WHERE agent_id = $1
    `, [agentRole]);
    console.log('  OK:', l.rows[0]);
  } catch(e) {
    console.log('  ERROR:', e.message);
  }

  // Query 7: planning snapshot gate
  console.log('7. gate...');
  try {
    const g = await c.query(`
      WITH run_flags AS (
        SELECT
          e.run_id,
          BOOL_OR(e.event_type = 'planning_phase_started') AS has_planning,
          BOOL_OR(e.event_type = 'completion_gate_passed') AS has_pass
        FROM agent_run_events e
        INNER JOIN agent_runs ar ON ar.id = e.run_id
        WHERE ar.agent_id = $1
          AND e.created_at >= NOW() - ($2::int * INTERVAL '1 day')
          AND e.event_type IN ('planning_phase_started', 'completion_gate_failed', 'completion_gate_passed')
        GROUP BY e.run_id
      )
      SELECT
        COUNT(*)::int AS runs_observed,
        COUNT(*) FILTER (WHERE has_planning)::int AS runs_with_planning,
        COUNT(*) FILTER (WHERE has_pass)::int AS runs_with_gate_pass
      FROM run_flags
    `, [agentRole, 30]);
    console.log('  OK:', g.rows[0]);
  } catch(e) {
    console.log('  ERROR:', e.message);
  }

  // Query 8: golden eval
  console.log('8. golden...');
  try {
    const ge = await c.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE r.score = 'PASS')::int AS passed
      FROM agent_eval_results r
      INNER JOIN agent_eval_scenarios s ON s.id = r.scenario_id
      WHERE r.agent_role = $1
        AND r.run_date >= NOW() - ($2::int * INTERVAL '1 day')
        AND s.scenario_name ILIKE 'golden:%'
    `, [agentRole, 30]);
    console.log('  OK:', ge.rows[0]);
  } catch(e) {
    console.log('  ERROR:', e.message);
  }

  await c.query('RESET ROLE').catch(() => {});
  await c.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
