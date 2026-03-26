import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  // Get column names first
  const cols = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'deep_dives' ORDER BY ordinal_position
  `);
  console.log('Columns:', cols.rows.map(r => r.column_name).join(', '));

  // Get recent deep dives
  const { rows } = await pool.query(`
    SELECT *
    FROM deep_dives
    ORDER BY created_at DESC
    LIMIT 5
  `);

  for (const r of rows) {
    console.log(`\n── ${r.id} ──`);
    console.log(`  Target:     ${r.target}`);
    console.log(`  Status:     ${r.status}`);
    console.log(`  Created:    ${r.created_at}`);
    console.log(`  Heartbeat:  ${r.heartbeat_at ?? 'n/a'}`);
    console.log(`  Report size: ${r.report ? JSON.stringify(r.report).length : 'null'} chars`);
    if (r.error) console.log(`  ERROR:      ${r.error}`);
    // Print any other interesting fields
    const skip = new Set(['id','target','status','created_at','heartbeat_at','report','error','visual_image']);
    for (const [k,v] of Object.entries(r)) {
      if (!skip.has(k) && v != null) console.log(`  ${k}: ${typeof v === 'object' ? JSON.stringify(v).slice(0,200) : v}`);
    }
  }

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
