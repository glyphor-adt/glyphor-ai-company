/**
 * Usage / cost diagnostics (6 SQL blocks).
 *   npm run db:usage-queries
 *   npx tsx scripts/run-with-gcp-db-secret.ts --db-user glyphor_app --db-password-secret db-password scripts/diagnostic-usage-queries.ts
 */
import { pool, closePool } from '@glyphor/shared/db';

const QUERIES: { title: string; sql: string }[] = [
  {
    title: '1. Model usage breakdown (30d, model_used not null)',
    sql: `
SELECT
  model_used,
  COUNT(*) AS run_count,
  ROUND(AVG(total_cost_usd)::numeric, 4) AS avg_cost_per_run,
  ROUND(SUM(total_cost_usd)::numeric, 4) AS total_cost,
  ROUND(AVG(total_input_tokens)::numeric) AS avg_input_tokens,
  ROUND(AVG(total_output_tokens)::numeric) AS avg_output_tokens,
  ROUND(AVG(duration_ms)::numeric) AS avg_duration_ms
FROM agent_runs
WHERE created_at > NOW() - INTERVAL '30 days'
AND model_used IS NOT NULL
GROUP BY model_used
ORDER BY total_cost DESC
`,
  },
  {
    title: '2. Cost per agent (30d, total_cost_usd not null)',
    sql: `
SELECT
  ar.agent_id,
  ca.display_name AS agent_name,
  COUNT(*) AS runs,
  ROUND(SUM(ar.total_cost_usd)::numeric, 4) AS total_cost,
  ROUND(AVG(ar.total_cost_usd)::numeric, 4) AS avg_cost_per_run,
  ar.model_used
FROM agent_runs ar
JOIN company_agents ca ON ca.role = ar.agent_id
WHERE ar.created_at > NOW() - INTERVAL '30 days'
AND ar.total_cost_usd IS NOT NULL
GROUP BY ar.agent_id, ca.display_name, ar.model_used
ORDER BY total_cost DESC
`,
  },
  {
    title: '3. Tool call costs (30d, top 30)',
    sql: `
SELECT
  tool_name,
  COUNT(*) AS call_count,
  ROUND(SUM(estimated_cost_usd)::numeric, 6) AS total_cost,
  ROUND(AVG(estimated_cost_usd)::numeric, 6) AS avg_cost_per_call,
  COUNT(*) FILTER (WHERE result_success = FALSE) AS failures
FROM tool_call_traces
WHERE called_at > NOW() - INTERVAL '30 days'
AND estimated_cost_usd IS NOT NULL
GROUP BY tool_name
ORDER BY total_cost DESC
LIMIT 30
`,
  },
  {
    title: '4. Agents vs models (7d, active roster)',
    sql: `
SELECT
  ca.role,
  ca.display_name,
  ca.model AS configured_model,
  ar.model_used AS actual_model_used,
  COUNT(*) AS runs
FROM company_agents ca
LEFT JOIN agent_runs ar ON ar.agent_id = ca.role
  AND ar.created_at > NOW() - INTERVAL '7 days'
WHERE ca.status = 'active'
GROUP BY ca.role, ca.display_name, ca.model, ar.model_used
ORDER BY ca.role, runs DESC
`,
  },
  {
    title: '5. Web search family tools (30d)',
    sql: `
SELECT
  agent_id,
  COUNT(*) AS search_calls,
  ROUND(SUM(estimated_cost_usd)::numeric, 6) AS total_cost
FROM tool_call_traces
WHERE tool_name IN ('web_search', 'query_keyword_data',
  'discover_keywords', 'web_fetch', 'web_get_url_content')
AND called_at > NOW() - INTERVAL '30 days'
GROUP BY agent_id
ORDER BY search_calls DESC
`,
  },
  {
    title: '6. ai_usage_log (30d, top 30) — table may be absent',
    sql: `
SELECT
  model,
  agent_role,
  SUM(input_tokens) AS total_input,
  SUM(output_tokens) AS total_output,
  SUM(cost_usd) AS total_cost,
  COUNT(*) AS calls
FROM ai_usage_log
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY model, agent_role
ORDER BY total_cost DESC
LIMIT 30
`,
  },
];

async function main(): Promise<void> {
  const out: { title: string; rows?: unknown[]; error?: string; rowCount?: number }[] = [];

  for (const { title, sql } of QUERIES) {
    try {
      const { rows } = await pool.query(sql.trim());
      out.push({ title, rows, rowCount: rows.length });
    } catch (e) {
      out.push({
        title,
        error: e instanceof Error ? e.message : String(e),
        rows: [],
        rowCount: 0,
      });
    }
  }

  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), results: out }, null, 2));
  await closePool();
}

main().catch(async (e) => {
  console.error(e);
  await closePool().catch(() => {});
  process.exit(1);
});
