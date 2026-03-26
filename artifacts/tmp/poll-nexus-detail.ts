import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const { rows } = await pool.query(
    `SELECT id, task, status, result_summary,
            created_at, completed_at,
            EXTRACT(EPOCH FROM (COALESCE(completed_at, NOW()) - created_at))::int AS duration_sec
       FROM agent_runs
      WHERE agent_id = 'platform-intel'
      ORDER BY created_at DESC
      LIMIT 5`
  );
  console.table(rows);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
