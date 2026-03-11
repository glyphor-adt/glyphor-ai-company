const { Client } = require('pg');

const connectionString = process.env.DATABASE_URL || 'postgresql://glyphor_system_user:lGHMxoC8zpmngKUaYv9cOTwJ@136.111.200.6:5432/glyphor';

const queries = {
  q1_actual_tasks_by_role: `
    SELECT DISTINCT agent_id AS agent_role, task
    FROM agent_runs
    WHERE agent_id IN ('ops', 'support-triage', 'cto', 'cfo', 'platform-engineer')
      AND created_at > NOW() - INTERVAL '24 hours'
    ORDER BY agent_role, task;
  `,
  q2_deterministic_rule_hits: `
    SELECT COALESCE(routing_rule, '__null__') AS routing_rule, COUNT(*)::int AS runs
    FROM agent_runs
    WHERE task IN ('health_check', 'freshness_check', 'cost_check', 'triage_queue', 'platform_health_check')
      AND created_at > NOW() - INTERVAL '24 hours'
    GROUP BY COALESCE(routing_rule, '__null__')
    ORDER BY runs DESC;
  `,
  q3_claude_candidate_agents_presence: `
    SELECT agent_id AS agent_role, COUNT(*)::int AS runs
    FROM agent_runs
    WHERE agent_id IN ('content-creator', 'clo', 'cmo', 'chief-of-staff')
      AND created_at > NOW() - INTERVAL '24 hours'
    GROUP BY agent_id
    ORDER BY runs DESC;
  `,
  q4_claude_candidate_capabilities: `
    SELECT agent_id AS agent_role, task, routing_capabilities, routing_rule, routing_model, created_at
    FROM agent_runs
    WHERE agent_id IN ('content-creator', 'clo', 'cmo')
      AND created_at > NOW() - INTERVAL '48 hours'
    ORDER BY created_at DESC
    LIMIT 20;
  `,
  q5_reflections_count_24h: `
    SELECT COUNT(*)::int AS reflections_24h
    FROM agent_reflections
    WHERE created_at > NOW() - INTERVAL '24 hours';
  `,
  q6_reflections_sample_24h: `
    SELECT id, agent_role, run_id, created_at
    FROM agent_reflections
    WHERE created_at > NOW() - INTERVAL '24 hours'
    ORDER BY created_at DESC
    LIMIT 10;
  `,
  q7_cost_breakdown_24h: `
    SELECT routing_model,
           COUNT(*)::int AS runs,
           ROUND(SUM(cost)::numeric, 2) AS total_cost,
           ROUND(SUM(input_tokens)::numeric / 1000000, 3) AS input_mtok,
           ROUND(SUM(output_tokens)::numeric / 1000000, 3) AS output_mtok
    FROM agent_runs
    WHERE created_at > NOW() - INTERVAL '24 hours'
    GROUP BY routing_model
    ORDER BY total_cost DESC NULLS LAST;
  `,
  q8_avg_input_by_agent_24h: `
    SELECT agent_id AS agent_role, ROUND(AVG(input_tokens))::int AS avg_input, COUNT(*)::int AS runs
    FROM agent_runs
    WHERE created_at > NOW() - INTERVAL '24 hours'
      AND status = 'completed'
    GROUP BY agent_id
    ORDER BY avg_input DESC NULLS LAST
    LIMIT 15;
  `,
  q9_avg_input_by_model_24h: `
    SELECT routing_model, ROUND(AVG(input_tokens))::int AS avg_input, COUNT(*)::int AS runs
    FROM agent_runs
    WHERE status = 'completed'
      AND created_at > NOW() - INTERVAL '24 hours'
    GROUP BY routing_model
    ORDER BY avg_input DESC NULLS LAST;
  `,
  q10_default_generalist_hits: `
    SELECT agent_id AS agent_role, task, routing_capabilities, COUNT(*)::int AS runs
    FROM agent_runs
    WHERE routing_rule = 'default_generalist'
      AND created_at > NOW() - INTERVAL '24 hours'
    GROUP BY agent_id, task, routing_capabilities
    ORDER BY runs DESC;
  `,
  q11_departments_populated: `
    SELECT role, team
    FROM company_agents
    WHERE status = 'active'
    ORDER BY team, role;
  `,
  q12_gpt54_max_input_runs: `
    SELECT agent_id AS agent_role, input_tokens, output_tokens, cost, task, routing_rule
    FROM agent_runs
    WHERE routing_model = 'gpt-5.4'
      AND created_at > NOW() - INTERVAL '24 hours'
    ORDER BY input_tokens DESC NULLS LAST
    LIMIT 5;
  `,
};

async function run() {
  const c = new Client({ connectionString });
  await c.connect();
  const out = { generatedAt: new Date().toISOString(), queries: {} };
  for (const [name, sql] of Object.entries(queries)) {
    try {
      const res = await c.query(sql);
      out.queries[name] = { ok: true, rowCount: res.rowCount, rows: res.rows };
    } catch (e) {
      out.queries[name] = { ok: false, error: e.message };
    }
  }
  await c.end();
  console.log(JSON.stringify(out, null, 2));
}

run().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
