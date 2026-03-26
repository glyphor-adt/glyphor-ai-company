import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
async function main() {
  const { rows } = await pool.query(`SELECT id, target, status, error, created_at, completed_at, started_at, last_heartbeat_at, report IS NOT NULL as has_report, framework_outputs IS NOT NULL as has_frameworks FROM deep_dives ORDER BY created_at DESC LIMIT 10`);
  console.table(rows);
  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
