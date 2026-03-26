import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const { rows } = await pool.query(`
    SELECT column_name, data_type
      FROM information_schema.columns
     WHERE table_name = 'fleet_findings'
       AND column_name IN ('agent_id', 'agent_role', 'detected_at', 'created_at')
     ORDER BY column_name
  `);
  console.table(rows);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
