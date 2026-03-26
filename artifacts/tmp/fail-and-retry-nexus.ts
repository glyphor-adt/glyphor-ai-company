import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  // 1. Fail the stuck run
  const fail = await pool.query(
    `UPDATE agent_runs
        SET status = 'failed',
            completed_at = NOW(),
            result_summary = 'Manually failed — stuck >10min, pre-deploy code'
      WHERE id = '692b146a-2434-4235-85bd-a7d20828e960'
        AND status = 'running'
      RETURNING id, status, completed_at`
  );
  console.log('Failed stuck run:');
  console.table(fail.rows);

  // 2. Insert new wake request
  const wake = await pool.query(
    `INSERT INTO agent_wake_queue (agent_role, task, reason, created_at)
     VALUES ('platform-intel', 'watch_tool_gaps', 'Retry after failing stuck run', NOW())
     RETURNING id, status, created_at`
  );
  console.log('\nNew wake request:');
  console.table(wake.rows);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
