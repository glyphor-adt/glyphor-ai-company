const { Client } = require('pg');
const c = new Client({ host: '127.0.0.1', port: 6543, database: 'glyphor', user: 'glyphor_app', password: 'TempAuth2026x' });
c.connect().then(async function() {
  var r = await c.query("SELECT agent_id, task, status, created_at, LEFT(error, 120) as err FROM agent_runs WHERE created_at > NOW() - INTERVAL '15 minutes' ORDER BY created_at DESC LIMIT 15");
  r.rows.forEach(function(row) {
    console.log(row.agent_id.padEnd(18), row.status.padEnd(10), row.task.padEnd(16), row.err || '');
  });
  await c.end();
}).catch(function(e) { console.error(e.message); });
