const { Client } = require('pg');
(async () => {
  const c = new Client({ host: '127.0.0.1', port: 6543, database: 'glyphor', user: 'glyphor_app', password: process.env.DB_PASSWORD });
  await c.connect();
  const q = async (l, s, p=[]) => { try { const r = await c.query(s, p); console.log('\n==', l, '=='); console.table(r.rows); } catch(e) { console.log(l, 'ERR', e.message); } };

  await q('gcp_billing recent (raw)', `SELECT recorded_at::date day, service, product, ROUND(SUM(cost_usd)::numeric,2) usd FROM gcp_billing WHERE recorded_at > NOW()-INTERVAL '14 days' GROUP BY 1,2,3 ORDER BY 1 DESC, 4 DESC LIMIT 30`);
  await q('actual_model null check today', `SELECT actual_model, COUNT(*)::int n, ROUND(SUM(total_cost_usd)::numeric,2) usd FROM agent_runs WHERE started_at >= CURRENT_DATE GROUP BY 1 ORDER BY 3 DESC`);
  await q('model_used null check today', `SELECT model_used, COUNT(*)::int n, ROUND(SUM(total_cost_usd)::numeric,2) usd FROM agent_runs WHERE started_at >= CURRENT_DATE GROUP BY 1 ORDER BY 3 DESC`);
  // Recompute using model_used fallback
  await q('today at REAL rates (fallback to model_used)', `
    WITH r AS (
      SELECT COALESCE(actual_model, model_used) AS model, total_input_tokens in_t, total_output_tokens out_t, total_thinking_tokens think_t, total_cost_usd est FROM agent_runs WHERE started_at >= CURRENT_DATE
    )
    SELECT
      ROUND(SUM(est)::numeric, 2) estimated_usd,
      ROUND(SUM(CASE
        WHEN model ILIKE 'gemini-3.1-pro%' THEN (COALESCE(in_t,0)*2.5 + COALESCE(out_t,0)*15 + COALESCE(think_t,0)*15) / 1e6
        WHEN model ILIKE 'gemini-3.1-flash-lite%' THEN (COALESCE(in_t,0)*0.10 + COALESCE(out_t,0)*0.40 + COALESCE(think_t,0)*0.40) / 1e6
        WHEN model ILIKE 'gemini-3-flash%' THEN (COALESCE(in_t,0)*1.25 + COALESCE(out_t,0)*5 + COALESCE(think_t,0)*5) / 1e6
        WHEN model ILIKE 'gemini-2.5-pro%' THEN (COALESCE(in_t,0)*1.25 + COALESCE(out_t,0)*10 + COALESCE(think_t,0)*10) / 1e6
        WHEN model ILIKE 'claude-sonnet-4%' THEN (COALESCE(in_t,0)*3 + COALESCE(out_t,0)*15) / 1e6
        WHEN model ILIKE 'claude-opus%' THEN (COALESCE(in_t,0)*15 + COALESCE(out_t,0)*75) / 1e6
        WHEN model ILIKE 'gpt-%' THEN (COALESCE(in_t,0)*1.25 + COALESCE(out_t,0)*10) / 1e6
        ELSE est
      END)::numeric, 2) real_usd
    FROM r`);
  await c.end();
})();
