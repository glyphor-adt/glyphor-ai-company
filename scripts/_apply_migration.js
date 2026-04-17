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
  await c.connect();
  const sql = fs.readFileSync('db/migrations/20260416180000_run_checkpoints.sql', 'utf8');
  await c.query(sql);
  console.log('Migration applied successfully');
  const r = await c.query("SELECT tablename FROM pg_tables WHERE tablename = 'run_checkpoints'");
  console.log('Table exists:', r.rows.length > 0);
  await c.end();
})().catch(e => { console.error('Migration failed:', e.message); process.exit(1); });
