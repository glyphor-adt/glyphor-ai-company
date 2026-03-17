const { Client } = require('pg');
const fs = require('fs');

(async () => {
  const c = new Client({
    host: '127.0.0.1',
    port: 6543,
    database: 'glyphor',
    user: 'glyphor_app',
    password: process.env.DB_PASSWORD,
  });

  const lines = [];
  const log = (...args) => { const line = args.join(' '); lines.push(line); };

  await c.connect();

  // Sarah's recent runs
  const runs = await c.query(`
    SELECT id, agent_id, task, status, error, created_at,
           substring(output from 1 for 2000) as out,
           tool_calls
    FROM agent_runs
    WHERE agent_id = 'chief-of-staff'
      AND created_at > now() - interval '90 minutes'
    ORDER BY created_at DESC
    LIMIT 5
  `);

  for (const row of runs.rows) {
    log('===', String(row.created_at), '|', row.task, '|', row.status, '| tools:', row.tool_calls);
    if (row.error) log('ERR:', String(row.error).slice(0, 600));
    if (row.out) log('OUT:', row.out.slice(0, 1000));
    log('');
  }

  // Check Cloud Run logs for email tool calls
  try {
    const toolCheck = await c.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_name LIKE '%tool_call%'
      ORDER BY table_name
    `);
    log('=== TOOL CALL TABLES ===');
    for (const row of toolCheck.rows) {
      log('  ', row.table_name);
    }
  } catch(e) {
    log('No tool call tables:', e.message);
  }

  await c.end();
  fs.writeFileSync('artifacts/tmp/_email_check_output.txt', lines.join('\n'));
  console.log('Output written to artifacts/tmp/_email_check_output.txt');
})().catch(e => { console.error('DB error:', e.message); process.exit(1); });
