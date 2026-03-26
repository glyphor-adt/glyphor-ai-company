import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const { rows } = await pool.query(
    `SELECT task, cron_expression, enabled, last_triggered_at
       FROM agent_schedules
      WHERE agent_id = 'platform-intel'
      ORDER BY task`
  );
  console.table(rows);
  console.log('Total:', rows.length);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
