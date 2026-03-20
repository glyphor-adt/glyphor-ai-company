const { Client } = require('pg');
(async () => {
  const c = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });
  await c.connect();

  console.log('=== SARAH SCHEDULES ===');
  const q1 = await c.query("SELECT * FROM agent_schedules WHERE agent_id='chief-of-staff' ORDER BY task");
  console.log(JSON.stringify(q1.rows, null, 2));

  console.log('\n=== ALL ORCHESTRATE SCHEDULES ===');
  const q2 = await c.query("SELECT agent_id, task, cron_expression, enabled FROM agent_schedules WHERE task='orchestrate' ORDER BY agent_id");
  console.log(JSON.stringify(q2.rows, null, 2));

  console.log('\n=== ALL SCHEDULES SUMMARY ===');
  const q3 = await c.query("SELECT agent_id, task, cron_expression, enabled FROM agent_schedules ORDER BY agent_id, task");
  console.log(JSON.stringify(q3.rows, null, 2));

  await c.end();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
