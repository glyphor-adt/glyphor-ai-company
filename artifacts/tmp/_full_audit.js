const { Client } = require('pg');

async function main() {
  const c = new Client({
    host: '127.0.0.1',
    port: 15432,
    database: 'glyphor',
    user: 'glyphor_app',
    password: process.env.DB_PASSWORD,
  });
  await c.connect();

  const queries = {
    // SYSTEM 1
    '1.1_outcomes_coverage': `
      SELECT COUNT(*) AS total, COUNT(assignment_id) AS linked,
      ROUND(COUNT(assignment_id)::numeric / NULLIF(COUNT(*),0) * 100, 1) AS coverage_pct
      FROM task_run_outcomes;`,

    '1.2a_assignment_evaluations': `
      SELECT evaluator_type, COUNT(*) AS row_count,
      ROUND(AVG(score_normalized)::numeric, 3) AS avg_score
      FROM assignment_evaluations
      GROUP BY evaluator_type ORDER BY evaluator_type;`,

    '1.2b_bad_scores': `
      SELECT COUNT(*) AS bad_rows FROM assignment_evaluations
      WHERE score_normalized < 0 OR score_normalized > 1;`,

    '1.3a_perf_buckets': `
      SELECT CASE
        WHEN performance_score >= 0.75 THEN 'healthy'
        WHEN performance_score >= 0.50 THEN 'degraded'
        WHEN performance_score IS NULL THEN 'unscored'
        ELSE 'unhealthy'
      END AS bucket, COUNT(*) AS count
      FROM agents GROUP BY 1;`,

    '1.3b_unscored_with_runs': `
      SELECT a.id, a.name, a.performance_score
      FROM agents a
      WHERE a.performance_score IS NULL
      AND EXISTS (
        SELECT 1 FROM agent_runs ar WHERE ar.agent_id = a.id AND ar.status = 'completed'
      );`,

    // SYSTEM 2
    '2.1a_prompt_versions': `
      SELECT COUNT(*) AS total_rows,
      COUNT(DISTINCT agent_id) AS agents_with_prompts,
      COUNT(*) FILTER (WHERE deployed_at IS NOT NULL AND retired_at IS NULL) AS active_versions
      FROM agent_prompt_versions;`,

    '2.1b_agents_no_prompts': `
      SELECT a.id, a.name FROM agents a
      WHERE NOT EXISTS (
        SELECT 1 FROM agent_prompt_versions apv WHERE apv.agent_id = a.id
      ) ORDER BY a.id;`,

    '2.2_reflection_mutations': `
      SELECT COUNT(*) AS reflection_mutations FROM agent_prompt_versions
      WHERE source = 'reflection';`,

    '2.3a_shadow_runs': `
      SELECT COUNT(*) AS total_shadow_runs,
      COUNT(DISTINCT agent_id) AS agents_in_shadow
      FROM shadow_runs;`,

    // SYSTEM 3
    '3.1a_world_state': `
      SELECT domain, COUNT(*) AS key_count, MAX(updated_at) AS last_write,
      COUNT(*) FILTER (WHERE valid_until < NOW()) AS expired_count
      FROM world_state GROUP BY domain ORDER BY last_write DESC;`,

    '3.2a_layer_column': `
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'company_knowledge_base' AND column_name = 'layer';`,

    '3.2b_kb_state': `
      SELECT layer, COUNT(*) AS sections, SUM(LENGTH(content)) AS total_chars,
      COUNT(*) FILTER (WHERE is_stale = TRUE) AS stale_count
      FROM company_knowledge_base
      GROUP BY layer ORDER BY layer;`,

    '3.3_read_kb_traces': `
      SELECT COUNT(*) AS cnt FROM tool_call_traces WHERE tool_name = 'read_company_knowledge';`,

    '3.4a_hardcoded_counts': `
      SELECT key, LEFT(content, 200) AS content_preview
      FROM company_knowledge_base
      WHERE content ~ '\\m[0-9]+\\s+(AI\\s+)?agents\\M'
      AND content NOT LIKE '%{active_agent_count}%';`,

    '3.4b_pricing': `
      SELECT key, is_stale, auto_expire, last_verified_at
      FROM company_knowledge_base WHERE key = 'pricing';`,

    '3.4c_icp': `
      SELECT key, content LIKE '%Teams-only%' AS has_teams_exclusion
      FROM company_knowledge_base WHERE key = 'icp_profile';`,

    // SYSTEM 4
    '4.1a_traces': `
      SELECT COUNT(*) AS total_traces,
      COUNT(DISTINCT agent_id) AS agents_traced,
      COUNT(*) FILTER (WHERE result_success = FALSE) AS failed_calls,
      MIN(called_at) AS first_trace, MAX(called_at) AS last_trace
      FROM tool_call_traces;`,

    '4.1b_retrieval_method': `
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'tool_call_traces' AND column_name = 'retrieval_method';`,

    '4.2_tool_accuracy_evals': `
      SELECT COUNT(*) AS cnt, ROUND(AVG(score_normalized)::numeric,3) AS avg
      FROM assignment_evaluations WHERE evaluator_type = 'tool_accuracy';`,

    '4.3a_failing_tools': `
      SELECT tool_name, COUNT(*) AS total_calls,
      COUNT(*) FILTER (WHERE result_success = FALSE) AS failures,
      ROUND(COUNT(*) FILTER (WHERE result_success = FALSE)::numeric / NULLIF(COUNT(*),0) * 100, 1) AS failure_pct
      FROM tool_call_traces
      WHERE called_at > NOW() - INTERVAL '7 days'
      GROUP BY tool_name
      HAVING COUNT(*) > 5
      ORDER BY failure_pct DESC LIMIT 10;`,

    '4.3b_tool_reputation': `
      SELECT COUNT(*) AS tools_tracked,
      COUNT(*) FILTER (WHERE success_rate < 0.8) AS degraded_tools
      FROM tool_reputation;`,

    // SYSTEM 5
    '5.1_gtm_reports': `
      SELECT COUNT(*) AS reports_generated, MAX(generated_at) AS last_run
      FROM gtm_readiness_reports;`,

    '5.2_latest_report': `
      SELECT report_json->'summary' AS summary
      FROM gtm_readiness_reports ORDER BY generated_at DESC LIMIT 1;`,

    '5.3a_eval_scenarios': `
      SELECT agent_id, COUNT(*) AS scenario_count
      FROM agent_eval_scenarios GROUP BY agent_id ORDER BY agent_id;`,

    '5.3b_eval_results': `
      SELECT MAX(evaluated_at) AS last_eval_run,
      COUNT(DISTINCT scenario_id) AS scenarios_evaluated
      FROM agent_eval_results;`,

    // SYSTEM 6
    '6.1a_nexus_agent': `
      SELECT id, name, status, performance_score, model
      FROM agents WHERE id = 'platform-intel';`,

    '6.1b_nexus_prompt': `
      SELECT version, source, deployed_at, LENGTH(prompt_text) AS prompt_length
      FROM agent_prompt_versions
      WHERE agent_id = 'platform-intel' AND deployed_at IS NOT NULL AND retired_at IS NULL;`,

    '6.2_nexus_runs': `
      SELECT COUNT(*) AS total_runs, MAX(created_at) AS last_run,
      ROUND(AVG(CASE WHEN status = 'completed' THEN 1.0 ELSE 0.0 END)::numeric, 3) AS completion_rate
      FROM agent_runs WHERE agent_id = 'platform-intel';`,

    '6.3_nexus_actions': `
      SELECT action_type, tier, status, created_at
      FROM platform_intel_actions ORDER BY created_at DESC LIMIT 10;`,

    // SYSTEM 7
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
      JOIN agents a ON a.id = ar.agent_id
      WHERE ar.created_at > NOW() - INTERVAL '7 days'
      GROUP BY ar.agent_id, a.name
      ORDER BY completion_pct ASC;`,

    '7.2_open_p0': `
      SELECT agent_id, severity, finding_type, description, detected_at,
      ROUND(EXTRACT(EPOCH FROM (NOW() - detected_at))/86400, 1) AS days_open
      FROM fleet_findings
      WHERE resolved_at IS NULL AND severity = 'P0'
      ORDER BY detected_at ASC;`,

    '7.3_no_runs': `
      SELECT a.id, a.name, a.department, a.status
      FROM agents a
      WHERE NOT EXISTS (SELECT 1 FROM agent_runs ar WHERE ar.agent_id = a.id)
      ORDER BY a.department;`,

    '7.4_marketing_recent': `
      WITH ranked AS (
        SELECT agent_id, status, created_at,
        ROW_NUMBER() OVER (PARTITION BY agent_id ORDER BY created_at DESC) AS rn
        FROM agent_runs
        WHERE agent_id IN ('cmo','content-creator','seo-analyst','social-media-manager','chief-of-staff')
      )
      SELECT agent_id, status, created_at FROM ranked WHERE rn <= 5 ORDER BY agent_id, rn;`,
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
