import { createDbPool } from './lib/migrationLedger.js';
async function main() {
  const pool = createDbPool();
  const r = await pool.query('SELECT id, agent_id, finding_type, severity, description, resolved_at, score_penalty FROM fleet_findings ORDER BY detected_at DESC');
  console.table(r.rows);
  console.log(`Total: ${r.rowCount} findings`);
  await pool.end();
}
main();
