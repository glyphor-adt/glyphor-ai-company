import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const { rows } = await pool.query(
    `SELECT task, status, result_summary, created_at
       FROM agent_runs
      WHERE agent_id = 'platform-intel'
        AND task IN ('watch_tool_gaps', 'daily_analysis')
      ORDER BY created_at DESC
      LIMIT 3`
  );
  console.table(rows);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
