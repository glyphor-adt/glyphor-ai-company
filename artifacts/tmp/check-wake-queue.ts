import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  // 1. Correct schedule query
  console.log('\n=== Nexus schedules ===');
  const scheds = await pool.query(
    `SELECT agent_id, task, enabled, last_triggered_at
       FROM agent_schedules
      WHERE agent_id = 'platform-intel'
      ORDER BY task`
  );
  console.table(scheds.rows);

  // 2. agent_wake_queue columns
  console.log('\n=== agent_wake_queue columns ===');
  const cols = await pool.query(
    `SELECT column_name, data_type
       FROM information_schema.columns
      WHERE table_name = 'agent_wake_queue'
      ORDER BY ordinal_position`
  );
  console.table(cols.rows);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
