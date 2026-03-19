import { pool } from '@glyphor/shared/db';

async function main() {
  const r = await pool.query(`
    SELECT id, tier, status, title, proposed_by, created_at
    FROM decisions
    WHERE created_at > NOW() - INTERVAL '1 day'
    ORDER BY created_at DESC LIMIT 10
  `);
  console.log('=== DECISIONS LAST 24H ===');
  for (const x of r.rows) console.log(JSON.stringify(x));

  const p = await pool.query(`
    SELECT id, proposed_by, title, status, created_at
    FROM proposed_initiatives
    WHERE created_at > NOW() - INTERVAL '1 day'
    ORDER BY created_at DESC LIMIT 5
  `);
  console.log('=== PROPOSALS LAST 24H ===');
  for (const x of p.rows) console.log(JSON.stringify(x));

  await pool.end();
}
main();
