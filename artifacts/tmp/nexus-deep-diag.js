import pg from 'pg';
const { Client } = pg;
async function main() {
  const c = new Client({
    host: '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '15432', 10),
    database: 'glyphor',
    user: 'glyphor_app',
    password: process.env.DB_PASSWORD,
  });
  await c.connect();

  // Agent config
  const [cfg] = (await c.query(
    `SELECT role, model, temperature, max_turns, thinking_enabled, status
       FROM company_agents WHERE role = 'platform-intel'`
  )).rows;
  console.log('=== Nexus agent config ===');
  console.log(cfg);

  // Last 5 runs with output snippets
  console.log('\n=== Last 5 daily_analysis runs (output preview) ===');
  const runs = await c.query(
    `SELECT id, task, status, turns, tool_calls, duration_ms, error,
            substring(output from 1 for 600) as output_preview
       FROM agent_runs
      WHERE agent_id = 'platform-intel'
        AND task = 'daily_analysis'
      ORDER BY started_at DESC LIMIT 5`
  );
  for (const r of runs.rows) {
    console.log(`\n--- [${r.status}] turns=${r.turns} tools=${r.tool_calls} ${r.duration_ms}ms ---`);
    if (r.error) console.log(`ERROR: ${r.error}`);
    console.log(`OUTPUT: ${r.output_preview || '(empty)'}`);
  }

  // Last 5 watch_tool_gaps runs
  console.log('\n=== Last 5 watch_tool_gaps runs (output preview) ===');
  const wtg = await c.query(
    `SELECT id, task, status, turns, tool_calls, duration_ms, error,
            substring(output from 1 for 600) as output_preview
       FROM agent_runs
      WHERE agent_id = 'platform-intel'
        AND task = 'watch_tool_gaps'
      ORDER BY started_at DESC LIMIT 5`
  );
  for (const r of wtg.rows) {
    console.log(`\n--- [${r.status}] turns=${r.turns} tools=${r.tool_calls} ${r.duration_ms}ms ---`);
    if (r.error) console.log(`ERROR: ${r.error}`);
    console.log(`OUTPUT: ${r.output_preview || '(empty)'}`);
  }

  // Check if thinking_enabled matters
  console.log('\n=== Nexus tool grant count ===');
  const grantCount = await c.query(
    `SELECT COUNT(*) FILTER (WHERE is_active = true AND is_blocked = false) as active,
            COUNT(*) FILTER (WHERE is_blocked = true) as blocked,
            COUNT(*) as total
       FROM agent_tool_grants
      WHERE agent_role = 'platform-intel'`
  );
  console.log(grantCount.rows[0]);

  await c.end();
}
main().catch(err => { console.error(err); process.exit(1); });
