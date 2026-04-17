import { readFileSync } from 'fs';
import pg from 'pg';
const { Client } = pg;

const c = new Client({
  host: '127.0.0.1',
  port: 6543,
  database: 'glyphor',
  user: 'glyphor_app',
  password: 'TempAuth2026x',
});

async function run() {
  await c.connect();
  console.log('Connected as glyphor_app');

  const sql = readFileSync('db/migrations/20260417160002_cz_surface_addon.sql', 'utf-8');
  await c.query(sql);
  console.log('Surface addon migration applied');

  // Verify
  const cols = await c.query(`
    SELECT column_name, data_type, column_default
    FROM information_schema.columns
    WHERE table_name = 'cz_runs' AND column_name = 'surface'
  `);
  console.log('surface column:', cols.rows);

  const tasks = await c.query('SELECT COUNT(*) AS n FROM cz_tasks WHERE active');
  console.log('Total active tasks:', tasks.rows[0].n);

  const p0 = await c.query('SELECT COUNT(*) AS n FROM cz_tasks WHERE is_p0 AND active');
  console.log('P0 tasks:', p0.rows[0].n);

  const pillars = await c.query(`
    SELECT pillar, COUNT(*) AS n FROM cz_tasks WHERE active GROUP BY pillar ORDER BY MIN(task_number)
  `);
  console.log('Tasks per pillar:');
  for (const r of pillars.rows) console.log(`   ${r.pillar} ${r.n}`);

  await c.end();
}
run().catch(e => { console.error(e.message); process.exit(1); });
