import { pool } from '@glyphor/shared/db';

async function main() {
  const fails = await pool.query(`
    SELECT tool_name, updated_at, total_calls, successful_calls, failed_calls, reliability_score
    FROM tool_reputation
    WHERE tool_name IN ('create_decision', 'propose_initiative', 'activate_initiative')
    ORDER BY updated_at DESC
  `);
  console.log('=== TOOL REPUTATION ===');
  for (const r of fails.rows) console.log(JSON.stringify(r));

  // Check security_events if table exists
  let secRows: any[] = [];
  try {
    const sec = await pool.query(`
      SELECT *
      FROM security_events
      WHERE event_type IN ('DATA_EVIDENCE_MISSING', 'TOOL_NOT_GRANTED')
      ORDER BY created_at DESC LIMIT 10
    `);
    secRows = sec.rows;
  } catch (e: any) {
    console.log('security_events table error:', e.message);
  }
  console.log('=== SECURITY EVENTS ===');
  for (const r of secRows) console.log(JSON.stringify(r));

  // Check schema
  const cols = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='agent_runs' ORDER BY ordinal_position`);
  console.log('=== AGENT_RUNS COLUMNS ===', cols.rows.map((r: any) => r.column_name).join(', '));

  const runs = await pool.query(`
    SELECT id, agent_id, task, status, error, started_at, actual_model
    FROM agent_runs
    WHERE agent_id LIKE '%chief-of-staff%'
      AND status IN ('failed', 'error')
    ORDER BY started_at DESC LIMIT 5
  `);
  console.log('=== FAILED COS RUNS ===');
  for (const r of runs.rows) console.log(JSON.stringify(r));

  // Also check the latest runs regardless of status
  const latest = await pool.query(`
    SELECT id, agent_id, task, status, error, started_at, tool_calls
    FROM agent_runs
    WHERE agent_id LIKE '%chief-of-staff%'
    ORDER BY started_at DESC LIMIT 3
  `);
  console.log('=== LATEST COS RUNS ===');
  for (const r of latest.rows) console.log(JSON.stringify(r));

  // Check tool_call_log or similar table
  let tclRows: any[] = [];
  try {
    const tcl = await pool.query(`
      SELECT *
      FROM tool_call_log
      WHERE tool_name IN ('create_decision', 'propose_initiative', 'activate_initiative')
        AND success = false
      ORDER BY called_at DESC LIMIT 10
    `);
    tclRows = tcl.rows;
  } catch (e: any) {
    console.log('tool_call_log error:', e.message);
  }
  console.log('=== FAILED TOOL CALLS ===');
  for (const r of tclRows) console.log(JSON.stringify(r));

  // Check recent decisions to see if they're actually being created
  const decs = await pool.query(`
    SELECT id, tier, status, title, proposed_by, created_at
    FROM decisions
    ORDER BY created_at DESC LIMIT 5
  `);
  console.log('=== RECENT DECISIONS ===');
  for (const r of decs.rows) console.log(JSON.stringify(r));

  await pool.end();
}
main();
