import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  // Mark stale deep dive as failed so user can re-trigger
  const { rowCount } = await pool.query(`
    UPDATE deep_dives
    SET status = 'failed',
        error = 'Deep dive execution stopped heartbeating after 2 completed areas. The scheduler process likely timed out during area research. Please re-run.',
        completed_at = COALESCE(completed_at, NOW()),
        last_heartbeat_at = NOW()
    WHERE id = 'deepdive-1774560866781-apeoa7'
      AND status != 'completed'
  `);

  console.log(`Updated ${rowCount} row(s) — deep dive marked as failed`);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
