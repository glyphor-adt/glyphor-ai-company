const { Client } = require('pg');

(async () => {
  const c = new Client({
    host: '127.0.0.1',
    port: 6543,
    database: 'glyphor',
    user: 'glyphor_app',
    password: process.env.DB_PASSWORD,
  });
  await c.connect();

  // 1. Today's runs - all statuses
  const r1 = await c.query(`
    SELECT agent_id as role, status, error, 
      duration_ms,
      completion_gate_passed as gate,
      started_at AT TIME ZONE 'UTC' as started
    FROM agent_runs
    WHERE started_at > now() - interval '1 day'
    ORDER BY started_at DESC
  `);
  console.log('\n=== TODAYS RUNS ===');
  console.table(r1.rows);

  // 2. What tool blocks look like (get reason from agent_run_events payload)
  const r2 = await c.query(`
    SELECT 
      ar.agent_id as role,
      e.payload->>'tool_name' as tool,
      e.payload->>'block_type' as block_type,
      e.payload->>'reason' as reason,
      e.payload->>'value_ratio' as value_ratio,
      e.payload->>'confidence' as confidence,
      COUNT(*) as count
    FROM agent_run_events e
    JOIN agent_runs ar ON ar.id = e.run_id
    WHERE e.created_at > now() - interval '7 days'
      AND e.event_type = 'tool.blocked'
    GROUP BY ar.agent_id, e.payload->>'tool_name', e.payload->>'block_type', 
             e.payload->>'reason', e.payload->>'value_ratio', e.payload->>'confidence'
    ORDER BY count DESC
    LIMIT 15
  `);
  console.log('\n=== TOOL BLOCK REASONS (7d) ===');
  console.table(r2.rows);

  // 3. Stall detection - what makes runs stall
  const r3 = await c.query(`
    SELECT 
      agent_id as role,
      status,
      error,
      duration_ms,
      total_cost_usd,
      completion_gate_passed as gate
    FROM agent_runs
    WHERE started_at > now() - interval '2 days'
      AND error = 'stalled'
    ORDER BY started_at DESC
    LIMIT 10
  `);
  console.log('\n=== STALLED RUNS (2d) ===');
  console.table(r3.rows);

  // 4. Runs per role by status last 7d
  const r4 = await c.query(`
    SELECT 
      agent_id as role,
      status,
      COUNT(*) as count
    FROM agent_runs
    WHERE started_at > now() - interval '7 days'
    GROUP BY agent_id, status
    ORDER BY agent_id, count DESC
  `);
  console.log('\n=== RUNS BY ROLE+STATUS (7d) ===');
  console.table(r4.rows);

  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
