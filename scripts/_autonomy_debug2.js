const { Client } = require('pg');
const c = new Client({
  connectionString: 'postgresql://glyphor_system_user:a7JwuQFobpCzZI+JWyPhCSheZFvIt2OA0rjt9FJvtJ4CaagtOM9p72mdTCM5IHzN@127.0.0.1:6543/glyphor'
});

async function main() {
  await c.connect();

  // Check agent_runs completion rate
  console.log('=== agent_runs completion (30d) ===');
  const runs = await c.query(`
    SELECT agent_id,
           COUNT(*)::int AS total_runs,
           COUNT(*) FILTER (WHERE status IN ('completed', 'failed', 'aborted', 'skipped_precheck'))::int AS terminal_runs,
           COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_runs
    FROM agent_runs
    WHERE started_at >= NOW() - INTERVAL '30 days'
    GROUP BY agent_id
    ORDER BY agent_id
  `);
  runs.rows.forEach(r => {
    const rate = parseInt(r.completed_runs) / Math.max(1, parseInt(r.terminal_runs) || parseInt(r.total_runs) || 1);
    console.log(`  ${r.agent_id}: ${r.completed_runs}/${r.terminal_runs} terminal (${r.total_runs} total) = ${rate.toFixed(3)}`);
  });

  // Now compute full eval for CTO and CFO
  const agents = ['cto', 'cfo', 'chief-of-staff', 'vp-research'];
  for (const role of agents) {
    const tr = await c.query('SELECT trust_score FROM agent_trust_scores WHERE agent_role = $1', [role]);
    const trust = parseFloat(tr.rows[0]?.trust_score ?? 0.5);

    const run = await c.query(`
      SELECT COUNT(*)::int AS total_runs,
             COUNT(*) FILTER (WHERE status IN ('completed','failed','aborted','skipped_precheck'))::int AS terminal_runs,
             COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_runs
      FROM agent_runs
      WHERE agent_id = $1 AND started_at >= NOW() - INTERVAL '30 days'
    `, [role]);
    const totalRuns = parseInt(run.rows[0]?.total_runs ?? 0);
    const terminalRuns = parseInt(run.rows[0]?.terminal_runs ?? 0);
    const completedRuns = parseInt(run.rows[0]?.completed_runs ?? 0);

    const outcome = await c.query(`
      SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE final_status = 'submitted')::int AS completed
      FROM task_run_outcomes
      WHERE agent_role = $1 AND created_at >= NOW() - INTERVAL '30 days'
    `, [role]);
    const totalOutcomes = parseInt(outcome.rows[0]?.total ?? 0);
    const completedOutcomes = parseInt(outcome.rows[0]?.completed ?? 0);

    const completionRate = totalOutcomes > 0
      ? completedOutcomes / Math.max(1, totalOutcomes)
      : completedRuns / Math.max(1, terminalRuns || totalRuns || 1);

    // Gate
    const gate = await c.query(`
      WITH run_flags AS (
        SELECT e.run_id,
               BOOL_OR(e.event_type = 'planning_phase_started') AS has_planning,
               BOOL_OR(e.event_type = 'completion_gate_passed') AS has_pass
        FROM agent_run_events e
        INNER JOIN agent_runs ar ON ar.id = e.run_id
        WHERE ar.agent_id = $1
          AND e.created_at >= NOW() - INTERVAL '30 days'
          AND e.event_type IN ('planning_phase_started', 'completion_gate_failed', 'completion_gate_passed')
        GROUP BY e.run_id
      )
      SELECT COUNT(*)::int AS runs_observed,
             COUNT(*) FILTER (WHERE has_planning)::int AS runs_with_planning,
             COUNT(*) FILTER (WHERE has_pass)::int AS runs_with_gate_pass
      FROM run_flags
    `, [role]);
    const gateRow = gate.rows[0] ?? { runs_observed: 0, runs_with_planning: 0, runs_with_gate_pass: 0 };
    const gateDenom = parseInt(gateRow.runs_with_planning) > 0 ? parseInt(gateRow.runs_with_planning) : parseInt(gateRow.runs_observed);
    const gateRate = gateDenom > 0 ? parseInt(gateRow.runs_with_gate_pass) / gateDenom : 0;

    // Golden
    const golden = await c.query(`
      SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE r.score = 'PASS')::int AS passed
      FROM agent_eval_results r
      INNER JOIN agent_eval_scenarios s ON s.id = r.scenario_id
      WHERE r.agent_role = $1 AND r.run_date >= NOW() - INTERVAL '30 days' AND s.scenario_name ILIKE 'golden:%'
    `, [role]);
    const goldenTotal = parseInt(golden.rows[0]?.total ?? 0);
    const goldenPassed = parseInt(golden.rows[0]?.passed ?? 0);
    const goldenRate = goldenTotal > 0 ? goldenPassed / goldenTotal : 0;

    // Composite
    let wTrust = 0.45, wGate = 0.35, wGolden = 0.2;
    if (gateDenom < 3) wGate = 0;
    if (goldenTotal < 2) wGolden = 0;
    const wSum = wTrust + wGate + wGolden;
    let composite = 0;
    if (wSum > 0) {
      composite = (wTrust / wSum) * trust;
      if (wGate > 0) composite += (wGate / wSum) * gateRate;
      if (wGolden > 0) composite += (wGolden / wSum) * goldenRate;
    }

    let ceiling = 0;
    if (composite >= 0.78) ceiling = 4;
    else if (composite >= 0.62) ceiling = 3;
    else if (composite >= 0.48) ceiling = 2;
    else if (composite >= 0.32) ceiling = 1;

    // Check threshold progress
    const thresholds = await c.query(`
      SELECT level, completion_rate_threshold, escalation_rate_max, min_tasks_completed
      FROM autonomy_level_thresholds
      ORDER BY level ASC
    `);
    console.log(`\n=== ${role} ===`);
    console.log(`  trust=${trust.toFixed(4)}, completion=${completionRate.toFixed(3)} (outcomes=${totalOutcomes}, runs=${completedRuns}/${terminalRuns})`);
    console.log(`  gate: rate=${gateRate.toFixed(3)} denom=${gateDenom}`);
    console.log(`  golden: rate=${goldenRate.toFixed(3)} total=${goldenTotal}`);
    console.log(`  composite=${composite.toFixed(4)} → ceiling=L${ceiling}`);

    // Build threshold progress
    let thresholdSuggested = 0;
    for (const t of thresholds.rows) {
      const level = t.level;
      const crThresh = parseFloat(t.completion_rate_threshold ?? 0);
      const erMax = parseFloat(t.escalation_rate_max ?? 1);
      const minTasks = parseInt(t.min_tasks_completed ?? 0);

      const meetsCompletion = completionRate >= crThresh;
      // escalation rate
      const escalationRate = totalOutcomes > 0
        ? 0  // simplified - need escalated outcomes
        : (totalRuns - completedRuns) / Math.max(1, totalRuns || 1);
      const meetsEscalation = escalationRate <= erMax;
      // lifetime completed
      const lifetimeCompleted = await c.query(`SELECT COUNT(*) FILTER (WHERE status = 'completed')::int AS count FROM agent_runs WHERE agent_id = $1`, [role]);
      const meetsMinTasks = parseInt(lifetimeCompleted.rows[0]?.count ?? 0) >= minTasks;

      const meets = meetsCompletion && meetsEscalation && meetsMinTasks;
      if (meets && level > thresholdSuggested) thresholdSuggested = level;
      console.log(`  L${level}: cr≥${crThresh}? ${meetsCompletion} | esc≤${erMax}? ${meetsEscalation}(${escalationRate.toFixed(3)}) | minTasks≥${minTasks}? ${meetsMinTasks} → ${meets ? 'MEETS' : 'FAILS'}`);
    }

    const suggested = Math.min(thresholdSuggested, ceiling);
    console.log(`  → thresholdSuggested=L${thresholdSuggested} ceiling=L${ceiling} → suggested=L${suggested}`);
  }

  await c.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
