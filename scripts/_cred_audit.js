const { Client } = require('pg');
const c = new Client({ host: '127.0.0.1', port: 6543, database: 'glyphor', user: 'glyphor_app', password: 'TempAuth2026x' });
c.connect().then(async function() {
  // Check which services have had credential failures
  var r = await c.query("SELECT agent_id, source, COUNT(*) as cnt FROM agent_runs WHERE error ILIKE '%Could not load credentials%' AND created_at > NOW() - INTERVAL '24 hours' GROUP BY agent_id, source ORDER BY cnt DESC");
  console.log('=== Credential failures by agent+source (24h) ===');
  console.table(r.rows);

  // Check current failures still happening (last 30 min)
  var r2 = await c.query("SELECT agent_id, task, status, created_at, LEFT(error, 100) as err FROM agent_runs WHERE created_at > NOW() - INTERVAL '30 minutes' ORDER BY created_at DESC LIMIT 15");
  console.log('\n=== Last 30 min runs ===');
  r2.rows.forEach(function(row) {
    console.log(String(row.created_at).substring(11,19), row.agent_id.padEnd(18), row.status.padEnd(10), row.task.padEnd(20), row.err || '');
  });

  await c.end();
}).catch(function(e) { console.error(e.message); });
