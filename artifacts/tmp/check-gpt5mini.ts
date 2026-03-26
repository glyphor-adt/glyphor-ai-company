import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS cnt FROM company_agents WHERE model = 'gpt-5-mini-2025-08-07'`
  );
  console.log('gpt-5-mini-2025-08-07 agents:', rows[0].cnt);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
