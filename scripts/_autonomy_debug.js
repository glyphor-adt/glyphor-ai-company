const { Client } = require('pg');
const c = new Client({
  connectionString: 'postgresql://glyphor_system_user:a7JwuQFobpCzZI+JWyPhCSheZFvIt2OA0rjt9FJvtJ4CaagtOM9p72mdTCM5IHzN@127.0.0.1:6543/glyphor'
});

async function main() {
  await c.connect();

  // Check auto_promote settings
  const configs = await c.query(`
    SELECT agent_id, current_level, max_allowed_level, auto_promote, auto_demote
    FROM agent_autonomy_config
    ORDER BY agent_id
  `);
  console.log('=== Autonomy configs ===');
  configs.rows.forEach(r => {
    console.log(`  ${r.agent_id}: L${r.current_level} max=L${r.max_allowed_level} promote=${r.auto_promote} demote=${r.auto_demote}`);
  });

  // Check gate data
  console.log('\n=== Gate events (30d) by agent ===');
  const gates = await c.query(`
    SELECT ar.agent_id,
           COUNT(DISTINCT e.run_id) AS runs_with_events,
           COUNT(*) FILTER (WHERE e.event_type = 'planning_phase_started') as planning,
           COUNT(*) FILTER (WHERE e.event_type = 'completion_gate_passed') as passed,
           COUNT(*) FILTER (WHERE e.event_type = 'completion_gate_failed') as failed
    FROM agent_run_events e
    JOIN agent_runs ar ON ar.id = e.run_id
    WHERE e.created_at >= NOW() - INTERVAL '30 days'
      AND e.event_type IN ('planning_phase_started', 'completion_gate_passed', 'completion_gate_failed')
    GROUP BY ar.agent_id
    ORDER BY ar.agent_id
  `);
  gates.rows.forEach(r => console.log(`  ${r.agent_id}: runs=${r.runs_with_events} planning=${r.planning} passed=${r.passed} failed=${r.failed}`));

  // Check golden eval data
  console.log('\n=== Golden eval (30d) by agent ===');
  const golden = await c.query(`
    SELECT r.agent_role,
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE r.score = 'PASS')::int AS passed
    FROM agent_eval_results r
    JOIN agent_eval_scenarios s ON s.id = r.scenario_id
    WHERE r.run_date >= NOW() - INTERVAL '30 days'
      AND s.scenario_name ILIKE 'golden:%'
    GROUP BY r.agent_role
    ORDER BY r.agent_role
  `);
  if (golden.rows.length === 0) console.log('  (no golden eval data)');
  else golden.rows.forEach(r => console.log(`  ${r.agent_role}: total=${r.total} passed=${r.passed}`));

  // Check trust scores
  console.log('\n=== Trust scores ===');
  const trust = await c.query(`SELECT agent_role, trust_score FROM agent_trust_scores ORDER BY agent_role`);
  trust.rows.forEach(r => console.log(`  ${r.agent_role}: ${r.trust_score}`));

  // Check completion rates
  console.log('\n=== Completion rates (30d outcomes) ===');
  const outcomes = await c.query(`
    SELECT agent_role,
           COUNT(*) as total,
           COUNT(*) FILTER (WHERE final_status = 'submitted') as completed,
           ROUND(COUNT(*) FILTER (WHERE final_status = 'submitted')::numeric / GREATEST(COUNT(*)::numeric, 1), 3) as rate
    FROM task_run_outcomes
    WHERE created_at > NOW() - INTERVAL '30 days'
    GROUP BY agent_role
    ORDER BY agent_role
  `);
  outcomes.rows.forEach(r => console.log(`  ${r.agent_role}: ${r.completed}/${r.total} = ${r.rate}`));

  // Level history
  console.log('\n=== Level history (recent) ===');
  const hist = await c.query(`
    SELECT agent_id, from_level, to_level, change_type, changed_at, reason
    FROM autonomy_level_history
    ORDER BY changed_at DESC
    LIMIT 10
  `);
  if (hist.rows.length === 0) console.log('  (empty)');
  else hist.rows.forEach(r => console.log(`  ${r.agent_id}: L${r.from_level}->L${r.to_level} ${r.change_type} @ ${r.changed_at}`));

  await c.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
