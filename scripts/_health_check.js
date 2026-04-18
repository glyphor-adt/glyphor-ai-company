const { Client } = require('pg');
const c = new Client({ host: '127.0.0.1', port: 6543, database: 'glyphor', user: 'glyphor_app', password: 'TempAuth2026x' });
c.connect().then(async function() {
  // Most recent runs only
  var r = await c.query("SELECT agent_id, task, status, created_at, LEFT(error, 120) as err FROM agent_runs WHERE created_at > NOW() - INTERVAL '5 minutes' ORDER BY created_at DESC LIMIT 10");
  console.log('=== Last 5 minutes ===');
  r.rows.forEach(function(row) {
    console.log(String(row.created_at).substring(11,19), row.agent_id.padEnd(18), row.status.padEnd(10), row.task.padEnd(20), row.err || '');
  });

  // Count successes vs failures in last 15min
  var stats = await c.query("SELECT status, COUNT(*) as cnt FROM agent_runs WHERE created_at > NOW() - INTERVAL '15 minutes' GROUP BY status");
  console.log('\n=== Last 15 min stats ===');
  console.table(stats.rows);

  await c.end();
}).catch(function(e) { console.error(e.message); });
