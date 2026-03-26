import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  // Insert wake request
  const result = await pool.query(
    `INSERT INTO agent_wake_queue (agent_role, task, reason, created_at)
     VALUES ('platform-intel', 'watch_tool_gaps', 'Manual trigger — verify watch_tool_gaps after detected_at fix', NOW())
     RETURNING id, agent_role, task, status, created_at`
  );
  console.log('Inserted wake request:');
  console.table(result.rows);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
