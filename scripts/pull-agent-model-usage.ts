/**
 * One-off: aggregate agent_runs by actual/routing model (default 7d).
 *   npx tsx --env-file=.env scripts/pull-agent-model-usage.ts
 */
import { pool, closePool } from '@glyphor/shared/db';

const DAYS = Number(process.env.MODEL_USAGE_DAYS ?? '7');

async function main(): Promise<void> {
  const byModel = await pool.query(
    `
    SELECT COALESCE(NULLIF(TRIM(actual_model), ''), NULLIF(TRIM(routing_model), ''), '(null)') AS resolved_model,
           actual_provider,
           routing_rule,
           COUNT(*)::int AS runs,
           ROUND(SUM(COALESCE(cost, 0))::numeric, 4) AS sum_cost_usd,
           ROUND(SUM(COALESCE(input_tokens, 0))::bigint::numeric) AS sum_input_tok,
           ROUND(SUM(COALESCE(output_tokens, 0))::bigint::numeric) AS sum_output_tok
    FROM agent_runs
    WHERE created_at > NOW() - ($1::text || ' days')::interval
      AND status = 'completed'
    GROUP BY 1, 2, 3
    ORDER BY sum_cost_usd DESC NULLS LAST
    LIMIT 50
    `,
    [String(DAYS)],
  );

  const byDay = await pool.query(
    `
    SELECT date_trunc('day', created_at AT TIME ZONE 'UTC')::date AS day_utc,
           ROUND(SUM(COALESCE(cost, 0))::numeric, 4) AS sum_cost_usd,
           COUNT(*)::int AS runs
    FROM agent_runs
    WHERE created_at > NOW() - ($1::text || ' days')::interval
      AND status = 'completed'
    GROUP BY 1
    ORDER BY 1 DESC
    `,
    [String(DAYS)],
  );

  const byAgent = await pool.query(
    `
    SELECT agent_id,
           COUNT(*)::int AS runs,
           ROUND(SUM(COALESCE(cost, 0))::numeric, 4) AS sum_cost_usd
    FROM agent_runs
    WHERE created_at > NOW() - ($1::text || ' days')::interval
      AND status = 'completed'
    GROUP BY agent_id
    ORDER BY sum_cost_usd DESC
    LIMIT 25
    `,
    [String(DAYS)],
  );

  console.log(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        windowDays: DAYS,
        byModel: byModel.rows,
        costByDayUtc: byDay.rows,
        byAgent: byAgent.rows,
      },
      null,
      2,
    ),
  );
  await closePool();
}

main().catch(async (e) => {
  console.error(e);
  await closePool().catch(() => {});
  process.exit(1);
});
