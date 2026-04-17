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

  // 1. Per-role gate stats
  const r1 = await c.query(`
    SELECT 
      ar.agent_id as role,
      COUNT(DISTINCT CASE WHEN e.event_type = 'planning_phase_started' THEN e.run_id END) as planned_runs,
      COUNT(CASE WHEN e.event_type = 'completion_gate_passed' THEN 1 END) as gate_passes,
      COUNT(CASE WHEN e.event_type = 'completion_gate_failed' THEN 1 END) as gate_fails,
      ROUND(100.0 * COUNT(CASE WHEN e.event_type = 'completion_gate_passed' THEN 1 END)::numeric / 
        NULLIF(COUNT(DISTINCT CASE WHEN e.event_type = 'planning_phase_started' THEN e.run_id END), 0), 1) as pass_pct
    FROM agent_run_events e
    JOIN agent_runs ar ON ar.id = e.run_id
    WHERE e.created_at > now() - interval '30 days'
      AND e.event_type IN ('planning_phase_started', 'completion_gate_passed', 'completion_gate_failed')
    GROUP BY ar.agent_id
    ORDER BY gate_fails DESC
  `);
  console.log('\n=== PER-ROLE GATE STATS (30d) ===');
  console.table(r1.rows);

  // 2. Most common missing criteria (from gate failures)
  const r2 = await c.query(`
    SELECT 
      ar.agent_id as role,
      e.payload->>'missing_criteria' as missing_criteria,
      e.payload->>'retry_attempt' as retry,
      e.created_at::date as date,
      ar.status as run_status
    FROM agent_run_events e
    JOIN agent_runs ar ON ar.id = e.run_id
    WHERE e.created_at > now() - interval '30 days'
      AND e.event_type = 'completion_gate_failed'
    ORDER BY e.created_at DESC
    LIMIT 30
  `);
  console.log('\n=== RECENT GATE FAILURES (last 30) ===');
  console.table(r2.rows);

  // 3. Run abort reasons
  const r3 = await c.query(`
    SELECT 
      agent_id as role,
      status,
      error,
      started_at::date as date,
      duration_ms,
      completion_gate_passed
    FROM agent_runs
    WHERE started_at > now() - interval '30 days'
      AND status IN ('failed', 'error', 'aborted', 'timeout')
    ORDER BY started_at DESC
    LIMIT 20
  `);
  console.log('\n=== FAILED/ABORTED RUNS (30d) ===');
  console.table(r3.rows);

  // 4. Gate failures with the full missing criteria text
  const r4 = await c.query(`
    SELECT 
      ar.agent_id as role,
      jsonb_array_elements_text(e.payload->'missing_criteria') as missing_criterion,
      COUNT(*) as occurrences
    FROM agent_run_events e
    JOIN agent_runs ar ON ar.id = e.run_id
    WHERE e.created_at > now() - interval '30 days'
      AND e.event_type = 'completion_gate_failed'
      AND e.payload->'missing_criteria' IS NOT NULL
      AND jsonb_typeof(e.payload->'missing_criteria') = 'array'
    GROUP BY ar.agent_id, jsonb_array_elements_text(e.payload->'missing_criteria')
    ORDER BY occurrences DESC
    LIMIT 30
  `);
  console.log('\n=== TOP MISSING CRITERIA (30d) ===');
  console.table(r4.rows);

  // 5. Value gate blocks
  const r5 = await c.query(`
    SELECT 
      ar.agent_id as role,
      e.event_type,
      e.payload->>'tool_name' as tool,
      e.payload->>'reason' as reason,
      COUNT(*) as count
    FROM agent_run_events e
    JOIN agent_runs ar ON ar.id = e.run_id
    WHERE e.created_at > now() - interval '7 days'
      AND e.event_type LIKE '%block%'
    GROUP BY ar.agent_id, e.event_type, e.payload->>'tool_name', e.payload->>'reason'
    ORDER BY count DESC
    LIMIT 20
  `);
  console.log('\n=== BLOCKED EVENTS (7d) ===');
  console.table(r5.rows);

  // 6. ACTION_RISK_BLOCKED from activity log
  const r6 = await c.query(`
    SELECT 
      agent_role,
      action,
      metadata->>'tool_name' as tool,
      metadata->>'block_reason' as reason,
      COUNT(*) as count
    FROM activity_log
    WHERE created_at > now() - interval '7 days'
      AND action LIKE '%BLOCK%'
    GROUP BY agent_role, action, metadata->>'tool_name', metadata->>'block_reason'
    ORDER BY count DESC
    LIMIT 20
  `);
  console.log('\n=== ACTIVITY LOG BLOCKS (7d) ===');
  console.table(r6.rows);

  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
