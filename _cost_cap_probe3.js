const { Client } = require('pg');
(async () => {
  const c = new Client({ host: '127.0.0.1', port: 6543, database: 'glyphor', user: 'glyphor_app', password: process.env.DB_PASSWORD });
  await c.connect();
  const q = async (l, s) => { try { const r = await c.query(s); console.log('\n==', l, '=='); console.table(r.rows); } catch(e) { console.log(l, 'ERR', e.message); } };
  await q('gcp_billing recent', `SELECT DATE(recorded_at) AS d, service, ROUND(SUM(cost_usd)::numeric,2) usd, SUM(usage) usage FROM gcp_billing WHERE recorded_at > NOW()-INTERVAL '14 days' GROUP BY 1,2 ORDER BY 1 DESC, 3 DESC LIMIT 30`);
  await q('gcp_billing all time by service', `SELECT service, COUNT(*)::int n, ROUND(SUM(cost_usd)::numeric,2) usd, MIN(recorded_at) earliest, MAX(recorded_at) latest FROM gcp_billing GROUP BY 1 ORDER BY 3 DESC LIMIT 20`);
  await c.end();
})();
