const { Client } = require('pg');
(async () => {
  const c = new Client({ host: '127.0.0.1', port: 6543, database: 'glyphor', user: 'glyphor_app', password: process.env.DB_PASSWORD });
  await c.connect();
  const q = async (l, s) => { try { const r = await c.query(s); console.log('\n==', l, '=='); console.table(r.rows); } catch(e) { console.log(l, 'ERR', e.message); } };
  await q('daily gemini-api billing last 14d', `SELECT DATE(recorded_at) d, ROUND(SUM(cost_usd)::numeric,2) usd FROM gcp_billing WHERE service IN ('gemini-api','vertex-ai') AND recorded_at > NOW()-INTERVAL '14 days' GROUP BY 1 ORDER BY 1 DESC`);
  await q('daily estimated vs gemini-api actual last 7d', `
    WITH est AS (
      SELECT DATE(started_at) d, ROUND(SUM(total_cost_usd) FILTER (WHERE actual_model ILIKE '%gemini%' OR model_used ILIKE '%gemini%')::numeric,2) est_usd
      FROM agent_runs WHERE started_at > NOW()-INTERVAL '7 days' GROUP BY 1
    ), bill AS (
      SELECT DATE(recorded_at) d, ROUND(SUM(cost_usd)::numeric,2) bill_usd
      FROM gcp_billing WHERE service IN ('gemini-api','vertex-ai') AND recorded_at > NOW()-INTERVAL '7 days' GROUP BY 1
    )
    SELECT COALESCE(est.d, bill.d) d, est.est_usd, bill.bill_usd,
           ROUND((est.est_usd / NULLIF(bill.bill_usd,0))::numeric, 2) ratio
    FROM est FULL OUTER JOIN bill ON est.d = bill.d ORDER BY 1 DESC`);
  await c.end();
})();
