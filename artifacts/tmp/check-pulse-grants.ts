import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS cnt FROM agent_tool_grants WHERE tool_name LIKE 'pulse_%'`
  );
  console.log('Pulse grants remaining:', rows[0].cnt);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
