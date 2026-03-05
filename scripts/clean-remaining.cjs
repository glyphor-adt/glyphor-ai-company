const { Pool } = require('pg');
const connStr = `postgresql://glyphor_system_user:${process.env.DB_PASSWORD}@127.0.0.1:15432/glyphor`;
const pool = new Pool({ connectionString: connStr });

async function main() {
  const r1 = await pool.query("DELETE FROM company_profile WHERE key = 'sales.win_loss_analysis' RETURNING key");
  console.log('Deleted win_loss_analysis:', r1.rowCount);

  const r2 = await pool.query("DELETE FROM company_profile WHERE key LIKE 'sales.market_sizing%' RETURNING key");
  console.log('Deleted market_sizing:', r2.rowCount);

  // Verify nothing sales.* remains
  const remaining = await pool.query("SELECT key FROM company_profile WHERE key LIKE 'sales.%'");
  console.log('Remaining sales.* keys:', remaining.rows.map(r => r.key));

  // Verify no pending vp-sales decisions remain
  const pending = await pool.query("SELECT id, title FROM decisions WHERE proposed_by = 'vp-sales' AND status = 'pending'");
  console.log('Remaining pending vp-sales decisions:', pending.rows.length);

  await pool.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
