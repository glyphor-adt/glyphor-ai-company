import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  // First check what the actual column names are
  const cols = await pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'agent_runs'
        AND column_name IN ('model_used', 'model', 'routing_model', 'cost_usd', 'cost', 'input_tokens', 'output_tokens')
      ORDER BY column_name`
  );
  console.log('Available columns:');
  console.table(cols.rows);

  // Use whatever model column exists
  const modelCol = cols.rows.find((r: any) => r.column_name === 'routing_model')
    ? 'routing_model'
    : cols.rows.find((r: any) => r.column_name === 'model_used')
      ? 'model_used'
      : 'model';

  const costCol = cols.rows.find((r: any) => r.column_name === 'cost_usd')
    ? 'cost_usd'
    : 'cost';

  const { rows } = await pool.query(
    `SELECT
       ${modelCol} AS model_used,
       COUNT(*)::int AS runs,
       SUM(input_tokens)::bigint AS total_input_tokens,
       SUM(output_tokens)::bigint AS total_output_tokens,
       ROUND(SUM(${costCol})::numeric, 2) AS total_cost,
       ROUND((SUM(${costCol}) / 7)::numeric, 2) AS avg_daily_cost
     FROM agent_runs
     WHERE created_at > NOW() - INTERVAL '7 days'
       AND ${modelCol} LIKE '%gemini%'
     GROUP BY ${modelCol}
     ORDER BY total_cost DESC`
  );
  console.log(`\nGemini usage (last 7 days) — model col: ${modelCol}, cost col: ${costCol}:`);
  console.table(rows);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
