const { Client } = require('pg');

async function main() {
  const c = new Client({
    host: '127.0.0.1', port: 15432, database: 'glyphor',
    user: 'glyphor_app', password: process.env.DB_PASSWORD,
  });
  await c.connect();

  const queries = {
    '1.3a_perf_buckets': `
      SELECT CASE
        WHEN performance_score >= 0.75 THEN 'healthy'
        WHEN performance_score >= 0.50 THEN 'degraded'
        WHEN performance_score IS NULL THEN 'unscored'
        ELSE 'unhealthy'
      END AS bucket, COUNT(*) AS count
      FROM company_agents GROUP BY 1;`,

    '1.3b_unscored_with_runs': `
      SELECT a.id, a.name, a.performance_score
      FROM company_agents a
      WHERE a.performance_score IS NULL
      AND EXISTS (
        SELECT 1 FROM agent_runs ar WHERE ar.agent_id = a.id AND ar.status = 'completed'
      );`,

    '2.1b_agents_no_prompts': `
      SELECT a.id, a.name FROM company_agents a
      WHERE NOT EXISTS (
        SELECT 1 FROM agent_prompt_versions apv WHERE apv.agent_id = a.id
      ) ORDER BY a.id;`,

    '3.4_kb_columns': `
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'company_knowledge_base' ORDER BY ordinal_position;`,

    '3.4a_hardcoded_counts': `
      SELECT section, LEFT(content, 200) AS content_preview
      FROM company_knowledge_base
      WHERE content ~ '\\m[0-9]+\\s+(AI\\s+)?agents\\M'
      AND content NOT LIKE '%{active_agent_count}%';`,

    '3.4b_pricing': `
      SELECT section, is_stale, auto_expire, last_verified_at
      FROM company_knowledge_base WHERE section = 'pricing';`,

    '3.4c_icp': `
      SELECT section, content LIKE '%Teams-only%' AS has_teams_exclusion
      FROM company_knowledge_base WHERE section = 'icp_profile';`,

    '5.3_eval_tables': `
      SELECT table_name FROM information_schema.tables
      WHERE table_name IN ('agent_eval_scenarios', 'agent_eval_results', 'gtm_readiness_reports')
      ORDER BY table_name;`,

    '5.3a_eval_scenarios_columns': `
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'agent_eval_scenarios' ORDER BY ordinal_position;`,

    '5.3b_eval_results_columns': `
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'agent_eval_results' ORDER BY ordinal_position;`,

    '6.1a_nexus_agent': `
      SELECT id, name, status, performance_score, model
      FROM company_agents WHERE id = 'platform-intel';`,

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
      JOIN company_agents a ON a.id = ar.agent_id
      WHERE ar.created_at > NOW() - INTERVAL '7 days'
      GROUP BY ar.agent_id, a.name
      ORDER BY completion_pct ASC;`,

    '7.3_no_runs': `
      SELECT a.id, a.name, a.department, a.status
      FROM company_agents a
      WHERE NOT EXISTS (SELECT 1 FROM agent_runs ar WHERE ar.agent_id = a.id)
      ORDER BY a.department;`,

    'total_agents': `SELECT COUNT(*) AS total FROM company_agents;`,

    'tool_call_traces_columns': `
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'tool_call_traces' ORDER BY ordinal_position;`,
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
