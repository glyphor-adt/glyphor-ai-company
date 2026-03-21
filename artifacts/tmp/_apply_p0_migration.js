const { Client } = require('pg');
const fs = require('fs');

(async () => {
  const c = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });
  await c.connect();
  const sql = fs.readFileSync('db/migrations/20260320200000_resolve_stale_p0s.sql', 'utf-8');
  const r = await c.query(sql);
  const counts = Array.isArray(r) ? r.map(x => x.rowCount) : [r.rowCount];
  console.log('Migration applied. Rows affected per UPDATE:', counts);
  await c.end();
})().catch(e => {
  console.error('MIGRATION ERROR:', e.message);
  process.exit(1);
});
