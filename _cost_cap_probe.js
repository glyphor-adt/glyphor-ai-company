const { Client } = require('pg');
(async () => {
  const c = new Client({ host: '127.0.0.1', port: 6543, database: 'glyphor', user: 'glyphor_app', password: process.env.DB_PASSWORD });
  await c.connect();
  const q = async (l, s, p=[]) => { try { const r = await c.query(s, p); console.log('\n==', l, '=='); console.table(r.rows); } catch(e) { console.log(l, 'ERR', e.message); } };

  await q('gcp_billing schema', `SELECT column_name FROM information_schema.columns WHERE table_name='gcp_billing'`);
  await q('gcp billing last 7d', `SELECT * FROM gcp_billing WHERE usage_start_time >= NOW() - INTERVAL '7 days' OR created_at >= NOW() - INTERVAL '7 days' ORDER BY 1 DESC LIMIT 30`);
  await q('today estimated fleet cost', `
    SELECT ROUND(SUM(total_cost_usd)::numeric, 2) estimated_today_usd,
           COUNT(*)::int runs,
           ROUND(SUM(total_input_tokens)::numeric, 0) input_tok,
           ROUND(SUM(total_output_tokens)::numeric, 0) output_tok
    FROM agent_runs WHERE started_at >= CURRENT_DATE`);

  // What it WOULD be at real Vertex list prices for gemini-3.1-pro-preview ($2.50/M in, $15/M out)
  await q('today at REAL rates', `
    SELECT ROUND(SUM(
      CASE
        WHEN actual_model ILIKE 'gemini-3.1-pro%' THEN (COALESCE(total_input_tokens,0)*2.5 + COALESCE(total_output_tokens,0)*15 + COALESCE(total_thinking_tokens,0)*15) / 1000000.0
        WHEN actual_model ILIKE 'gemini-3.1-flash-lite%' THEN (COALESCE(total_input_tokens,0)*0.10 + COALESCE(total_output_tokens,0)*0.40 + COALESCE(total_thinking_tokens,0)*0.40) / 1000000.0
        WHEN actual_model ILIKE 'gemini-3-flash%' THEN (COALESCE(total_input_tokens,0)*1.25 + COALESCE(total_output_tokens,0)*5 + COALESCE(total_thinking_tokens,0)*5) / 1000000.0
        WHEN actual_model ILIKE 'gemini-2.5-pro%' THEN (COALESCE(total_input_tokens,0)*1.25 + COALESCE(total_output_tokens,0)*10 + COALESCE(total_thinking_tokens,0)*10) / 1000000.0
        ELSE total_cost_usd
      END
    )::numeric, 2) real_today_usd,
    ROUND(SUM(total_cost_usd)::numeric, 2) estimated_today_usd
    FROM agent_runs WHERE started_at >= CURRENT_DATE`);

  await q('cost_source distribution', `
    SELECT cost_source, COUNT(*)::int n, ROUND(SUM(total_cost_usd)::numeric,2) usd
    FROM agent_runs WHERE started_at >= CURRENT_DATE GROUP BY 1 ORDER BY 3 DESC`);

  await c.end();
})();
