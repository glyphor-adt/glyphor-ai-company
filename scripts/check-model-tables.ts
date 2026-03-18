import { createDbPool } from './lib/migrationLedger.js';
async function main() {
  const pool = createDbPool();
  try {
    const r1 = await pool.query('SELECT count(*) as c FROM model_registry');
    console.log('model_registry rows:', r1.rows[0].c);
    const r2 = await pool.query('SELECT count(*) as c FROM routing_config');
    console.log('routing_config rows:', r2.rows[0].c);
    const r3 = await pool.query("SELECT slug, display_name, is_active FROM model_registry ORDER BY tier, slug");
    console.table(r3.rows);
    const r4 = await pool.query("SELECT route_name, model_slug, priority, is_active FROM routing_config ORDER BY priority DESC");
    console.table(r4.rows);
  } catch (err: any) {
    console.error('ERROR:', err.message);
  }
  await pool.end();
}
main();
