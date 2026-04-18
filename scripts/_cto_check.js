const { Client } = require('pg');
const c = new Client({ host: '127.0.0.1', port: 6543, database: 'glyphor', user: 'glyphor_app', password: 'TempAuth2026x' });
c.connect().then(async () => {
  const r = await c.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'agent_runs' ORDER BY ordinal_position");
  console.log(r.rows.map(function(x) { return x.column_name; }).join(', '));

  console.log('\n=== CTO recent runs ===');
  const cto = await c.query("SELECT id, agent_id, status, task, created_at, LEFT(error, 200) as err FROM agent_runs WHERE agent_id = 'cto' ORDER BY created_at DESC LIMIT 5");
  cto.rows.forEach(function(row) {
    console.log(row.created_at, '|', row.status, '|', row.task, row.err ? '| ERR: ' + row.err : '');
  });

  await c.end();
}).catch(function(e) { console.error(e.message); });
