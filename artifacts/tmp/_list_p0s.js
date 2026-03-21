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
  const r = await c.query(
    `SELECT agent_id, finding_type, substring(description from 1 for 200) as descr
     FROM fleet_findings
     WHERE severity = 'P0' AND resolved_at IS NULL
     ORDER BY detected_at DESC`
  );
  for (const row of r.rows) {
    console.log(`${row.agent_id} | ${row.finding_type} | ${row.descr}`);
  }
  console.log(`\nTotal open P0s: ${r.rows.length}`);
  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
