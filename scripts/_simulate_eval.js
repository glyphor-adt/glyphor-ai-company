const { Client } = require('pg');
const c = new Client({
  connectionString: 'postgresql://glyphor_system_user:a7JwuQFobpCzZI+JWyPhCSheZFvIt2OA0rjt9FJvtJ4CaagtOM9p72mdTCM5IHzN@127.0.0.1:6543/glyphor'
});

async function main() {
  await c.connect();

  // Simulate composite score computation for each active agent
  const agents = ['cto', 'chief-of-staff', 'cfo', 'cmo', 'cpo', 'ops', 'vp-design', 'vp-research', 'devops-engineer', 'platform-engineer', 'quality-engineer'];

  for (const role of agents) {
    // Trust
    const tr = await c.query('SELECT trust_score FROM agent_trust_scores WHERE agent_role = $1', [role]);
    const trust = tr.rows[0]?.trust_score ?? 0.5;

    // Gate pass (30d)
    const gate = await c.query(`
      SELECT
        COUNT(*) FILTER (WHERE event_type = 'completion_gate_passed') as passed,
        COUNT(*) FILTER (WHERE event_type IN ('completion_gate_passed', 'completion_gate_failed')) as total
      FROM agent_run_events
      WHERE agent_role = $1 AND created_at > NOW() - INTERVAL '30 days'
        AND event_type IN ('completion_gate_passed', 'completion_gate_failed')
    `, [role]);
    const gatePass = parseInt(gate.rows[0]?.passed ?? 0);
    const gateTotal = parseInt(gate.rows[0]?.total ?? 0);
    const gateRate = gateTotal > 0 ? gatePass / gateTotal : 0;

    // Golden eval (30d)
    const golden = await c.query(`
      SELECT
        COUNT(*) FILTER (WHERE result = 'PASS') as passed,
        COUNT(*) as total
      FROM agent_eval_results r
      JOIN agent_eval_scenarios s ON s.id = r.scenario_id
      WHERE r.agent_role = $1
        AND r.evaluated_at > NOW() - INTERVAL '30 days'
        AND s.scenario_name ILIKE 'golden:%'
    `, [role]);
    const goldenPass = parseInt(golden.rows[0]?.passed ?? 0);
    const goldenTotal = parseInt(golden.rows[0]?.total ?? 0);
    const goldenRate = goldenTotal > 0 ? goldenPass / goldenTotal : 0;

    // Completion rate (from task_run_outcomes)
    const outcomes = await c.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE final_status = 'submitted') as completed
      FROM task_run_outcomes
      WHERE agent_role = $1 AND created_at > NOW() - INTERVAL '30 days'
    `, [role]);
    const outcomeTotal = parseInt(outcomes.rows[0]?.total ?? 0);
    const outcomeCompleted = parseInt(outcomes.rows[0]?.completed ?? 0);

    // Fallback to agent_runs
    const runs = await c.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status IN ('completed','failed','aborted','skipped_precheck')) as terminal
      FROM agent_runs
      WHERE agent_id = $1 AND started_at > NOW() - INTERVAL '30 days'
    `, [role]);
    const runTotal = parseInt(runs.rows[0]?.total ?? 0);
    const runCompleted = parseInt(runs.rows[0]?.completed ?? 0);
    const runTerminal = parseInt(runs.rows[0]?.terminal ?? 0);

    const completionRate = outcomeTotal > 0
      ? outcomeCompleted / Math.max(1, outcomeTotal)
      : runCompleted / Math.max(1, runTerminal || runTotal || 1);

    // Compute composite (same logic as code)
    let wTrust = 0.45, wGate = 0.35, wGolden = 0.2;
    if (gateTotal < 3) wGate = 0;
    if (goldenTotal < 2) wGolden = 0;
    const wSum = wTrust + wGate + wGolden;
    let composite = 0;
    if (wSum > 0) {
      composite = (wTrust / wSum) * trust;
      if (wGate > 0) composite += (wGate / wSum) * gateRate;
      if (wGolden > 0) composite += (wGolden / wSum) * goldenRate;
    }

    // Ceiling level
    let ceiling = 0;
    if (composite >= 0.78) ceiling = 4;
    else if (composite >= 0.62) ceiling = 3;
    else if (composite >= 0.48) ceiling = 2;
    else if (composite >= 0.32) ceiling = 1;

    // Threshold suggested level
    // L0: no requirements. L1: completion >= 0.7. L2: completion >= 0.85, escalation <= 0.2. L3: completion >= 0.93, escalation <= 0.08. L4: completion >= 0.97, escalation <= 0.03, min 500 tasks lifetime.
    let thresholdLevel = 0;
    if (completionRate >= 0.7) thresholdLevel = 1;
    if (completionRate >= 0.85) thresholdLevel = 2; // also needs escalation <= 0.2 but ignoring for now
    if (completionRate >= 0.93) thresholdLevel = 3;
    if (completionRate >= 0.97) thresholdLevel = 4;

    const suggested = Math.min(thresholdLevel, ceiling);

    console.log(`${role}: trust=${trust.toFixed(3)} gate=${gateRate.toFixed(2)}(n=${gateTotal}) golden=${goldenRate.toFixed(2)}(n=${goldenTotal}) completion=${completionRate.toFixed(3)} composite=${composite.toFixed(3)} ceiling=L${ceiling} threshold=L${thresholdLevel} → suggested=L${suggested}`);
  }

  await c.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
