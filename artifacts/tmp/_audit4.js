const { Client } = require('pg');

async function main() {
  const c = new Client({
    host: '127.0.0.1', port: 15432, database: 'glyphor',
    user: 'glyphor_app', password: process.env.DB_PASSWORD,
  });
  await c.connect();

  const queries = {
    '1.3b_unscored_with_runs': `
      SELECT a.role, a.name, a.performance_score
      FROM company_agents a
      WHERE a.performance_score IS NULL
      AND EXISTS (
        SELECT 1 FROM agent_runs ar WHERE ar.agent_id = a.role AND ar.status = 'completed'
      );`,

    '7.1_run_health': `
      SELECT
        ar.agent_id,
        a.name,
        COUNT(*) AS total_runs,
        COUNT(*) FILTER (WHERE ar.status = 'completed') AS completed,
        COUNT(*) FILTER (WHERE ar.status = 'aborted') AS aborted,
        COUNT(*) FILTER (WHERE ar.status = 'failed') AS failed,
        ROUND(COUNT(*) FILTER (WHERE ar.status = 'completed')::numeric / NULLIF(COUNT(*),0) * 100, 1) AS completion_pct
      FROM agent_runs ar
      LEFT JOIN company_agents a ON a.role = ar.agent_id
      WHERE ar.created_at > NOW() - INTERVAL '7 days'
      GROUP BY ar.agent_id, a.name
      ORDER BY completion_pct ASC;`,

    '7.3_no_runs': `
      SELECT a.role, a.name, a.department, a.status
      FROM company_agents a
      WHERE NOT EXISTS (SELECT 1 FROM agent_runs ar WHERE ar.agent_id = a.role)
      ORDER BY a.department;`,
  };

  const results = {};
  for (const [key, sql] of Object.entries(queries)) {
    try {
      const r = await c.query(sql);
      results[key] = r.rows;
    } catch (e) {
      results[key] = { error: e.message };
    }
  }
  console.log(JSON.stringify(results, null, 2));
  await c.end();
}
main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
