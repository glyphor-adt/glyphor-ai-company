import { pool } from '@glyphor/shared/db';

async function main() {
  // Check decisions schema
  const cols = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='decisions' ORDER BY ordinal_position`);
  console.log('=== DECISIONS COLUMNS ===', cols.rows.map((r: any) => r.column_name).join(', '));

  // Resolve the stale P0 decisions about 401 error
  const decisions = await pool.query(`
    UPDATE decisions
    SET status = 'resolved'
    WHERE status = 'pending'
      AND title LIKE '%create_decision%401%'
    RETURNING id, title
  `);
  console.log('=== RESOLVED P0 DECISIONS ===');
  for (const r of decisions.rows) console.log(JSON.stringify(r));

  await pool.end();
}
main();
