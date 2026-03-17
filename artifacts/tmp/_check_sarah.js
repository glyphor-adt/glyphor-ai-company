const { Client } = require('pg');

(async () => {
  const c = new Client({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 6543),
    database: process.env.DB_NAME || 'glyphor',
    user: process.env.DB_USER || 'glyphor_app',
    password: process.env.DB_PASSWORD,
  });

  try {
    await c.connect();

    // First get the columns of agent_runs
    const cols = await c.query(`SELECT column_name FROM information_schema.columns WHERE table_name='agent_runs' ORDER BY ordinal_position`);
    console.log('=== agent_runs columns ===');
    console.log(cols.rows.map(r => r.column_name).join(', '));
    console.log();

    // Check Sarah's recent runs
    const runs = await c.query(`
      SELECT id, agent_id, status, task, actual_model, error, created_at,
             substring(output from 1 for 800) as output_snip,
             substring(result_summary from 1 for 500) as summary
      FROM agent_runs
      WHERE agent_id = 'chief-of-staff'
        AND created_at > now() - interval '6 hours'
      ORDER BY created_at DESC
      LIMIT 10
    `);
    console.log('=== SARAH RECENT RUNS ===');
    for (const row of runs.rows) {
      console.log(`  ${row.created_at} | ${row.task} | ${row.status} | model=${row.actual_model}`);
      if (row.error) console.log(`    ERROR: ${String(row.error).slice(0, 400)}`);
      if (row.summary) console.log(`    SUMMARY: ${row.summary.slice(0, 400)}`);
      if (row.output_snip) console.log(`    OUTPUT: ${row.output_snip.slice(0, 400)}`);
      console.log();
    }

    // Check tool_reputation for email failures
    const rep = await c.query(`
      SELECT tool_name, total_calls, success_count, failure_count, last_error, last_used_at
      FROM tool_reputation
      WHERE tool_name ILIKE '%email%' OR tool_name ILIKE '%mail%' OR tool_name ILIKE '%reply%' OR tool_name ILIKE '%attach%'
      ORDER BY last_used_at DESC NULLS LAST
      LIMIT 20
    `);
    console.log('=== EMAIL TOOL REPUTATION ===');
    for (const row of rep.rows) {
      console.log(`  ${row.tool_name} | calls=${row.total_calls} success=${row.success_count} fail=${row.failure_count} | last=${row.last_used_at}`);
      if (row.last_error) console.log(`    LAST ERROR: ${String(row.last_error).slice(0, 400)}`);
      console.log();
    }

  } catch (e) {
    console.error('DB error:', e.message);
  } finally {
    try { await c.end(); } catch {}
  }
})();
