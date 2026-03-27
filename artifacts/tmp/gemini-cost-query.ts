import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const { rows } = await pool.query(`
    SELECT 
      agent_id,
      model_used,
      COUNT(*) as runs,
      ROUND(SUM(total_cost_usd::numeric), 4) as total_cost,
      ROUND(SUM(total_cost_usd::numeric) / 7, 4) as avg_daily_cost
    FROM agent_runs
    WHERE created_at > NOW() - INTERVAL '7 days'
      AND model_used LIKE '%gemini%'
    GROUP BY agent_id, model_used
    ORDER BY total_cost DESC
    LIMIT 20
  `);

  console.table(rows);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
