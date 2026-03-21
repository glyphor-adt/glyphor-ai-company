const { Client } = require('pg');

async function main() {
  const c = new Client({
    host: '127.0.0.1', port: 15432, database: 'glyphor',
    user: 'glyphor_app', password: process.env.DB_PASSWORD,
  });
  await c.connect();

  const queries = {
    'agents_schema': `
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_name = 'company_agents' AND column_name IN ('id','name','role','department','status','performance_score','model')
      ORDER BY ordinal_position;`,

    'agent_runs_schema': `
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_name = 'agent_runs' AND column_name IN ('id','agent_id','agent_role','status')
      ORDER BY ordinal_position;`,

    '1.3b_unscored_with_runs': `
      SELECT a.role, a.name, a.performance_score
      FROM company_agents a
      WHERE a.performance_score IS NULL
      AND EXISTS (
        SELECT 1 FROM agent_runs ar WHERE ar.agent_role = a.role AND ar.status = 'completed'
      );`,

    '2.1b_agents_no_prompts': `
      SELECT a.role, a.name FROM company_agents a
      WHERE NOT EXISTS (
        SELECT 1 FROM agent_prompt_versions apv WHERE apv.agent_id = a.role
      ) ORDER BY a.role;`,

    '5.3a_eval_scenarios': `
      SELECT agent_role, COUNT(*) AS scenario_count
      FROM agent_eval_scenarios GROUP BY agent_role ORDER BY agent_role;`,

    '5.3b_eval_results': `
      SELECT MAX(run_date) AS last_eval_run,
      COUNT(DISTINCT scenario_id) AS scenarios_evaluated
      FROM agent_eval_results;`,

    '6.1a_nexus_agent': `
      SELECT role, name, status, performance_score, model
      FROM company_agents WHERE role = 'platform-intel';`,

    '7.1_run_health': `
      SELECT
        ar.agent_role,
        a.name,
        COUNT(*) AS total_runs,
        COUNT(*) FILTER (WHERE ar.status = 'completed') AS completed,
        COUNT(*) FILTER (WHERE ar.status = 'aborted') AS aborted,
        COUNT(*) FILTER (WHERE ar.status = 'failed') AS failed,
        ROUND(COUNT(*) FILTER (WHERE ar.status = 'completed')::numeric / NULLIF(COUNT(*),0) * 100, 1) AS completion_pct
      FROM agent_runs ar
      LEFT JOIN company_agents a ON a.role = ar.agent_role
      WHERE ar.created_at > NOW() - INTERVAL '7 days'
      GROUP BY ar.agent_role, a.name
      ORDER BY completion_pct ASC;`,

    '7.3_no_runs': `
      SELECT a.role, a.name, a.department, a.status
      FROM company_agents a
      WHERE NOT EXISTS (SELECT 1 FROM agent_runs ar WHERE ar.agent_role = a.role)
      ORDER BY a.department;`,

    'perf_buckets_v2': `
      SELECT CASE
        WHEN performance_score >= 0.75 THEN 'healthy'
        WHEN performance_score >= 0.50 THEN 'degraded'
        WHEN performance_score IS NULL THEN 'unscored'
        ELSE 'unhealthy'
      END AS bucket, COUNT(*) AS count, 
      string_agg(name, ', ' ORDER BY name) AS agents
      FROM company_agents GROUP BY 1 ORDER BY 1;`,
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
