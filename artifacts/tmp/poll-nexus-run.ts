import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const { rows } = await pool.query(
    `SELECT task, status, result_summary, created_at
       FROM agent_runs
      WHERE agent_id = 'platform-intel'
      ORDER BY created_at DESC
      LIMIT 3`
  );
  console.table(rows);

  // Also check wake queue status
  const wake = await pool.query(
    `SELECT id, status, dispatched_at
       FROM agent_wake_queue
      WHERE agent_role = 'platform-intel'
      ORDER BY created_at DESC
      LIMIT 1`
  );
  console.log('\nWake queue status:');
  console.table(wake.rows);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
