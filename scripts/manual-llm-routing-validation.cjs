const { Client } = require('pg');

const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://glyphor_system_user:lGHMxoC8zpmngKUaYv9cOTwJ@136.111.200.6:5432/glyphor';

const tests = [
  {
    id: '1.1',
    name: 'Routing Columns Exist',
    sql: `
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'agent_runs'
  AND column_name IN ('routing_rule', 'routing_capabilities', 'routing_model')
ORDER BY column_name;`,
    evaluate: (rows) => ({
      passed: rows.length === 3,
      summary: `columns_found=${rows.length}`,
    }),
  },
  {
    id: '1.2',
    name: 'Routing Data Logged (1h)',
    sql: `
SELECT COUNT(*)::int AS total_runs,
       COUNT(routing_rule)::int AS runs_with_routing,
       (COUNT(*) - COUNT(routing_rule))::int AS runs_without_routing
FROM agent_runs
WHERE created_at > NOW() - INTERVAL '1 hour';`,
    evaluate: (rows) => {
      const r = rows[0] || { total_runs: 0, runs_with_routing: 0, runs_without_routing: 0 };
      const passed = Number(r.runs_without_routing) === 0;
      return {
        passed,
        summary: `total=${r.total_runs}, with=${r.runs_with_routing}, without=${r.runs_without_routing}`,
      };
    },
  },
  {
    id: '1.3',
    name: 'Routing Rule Distribution (4h)',
    sql: `
SELECT routing_rule, routing_model, COUNT(*)::int AS runs
FROM agent_runs
WHERE created_at > NOW() - INTERVAL '4 hours'
  AND routing_rule IS NOT NULL
GROUP BY routing_rule, routing_model
ORDER BY runs DESC;`,
    evaluate: (rows) => {
      const total = rows.reduce((s, r) => s + Number(r.runs || 0), 0);
      const defaultRow = rows.find((r) => r.routing_rule === 'default');
      const defaultRuns = defaultRow ? Number(defaultRow.runs) : 0;
      const defaultPct = total > 0 ? (100 * defaultRuns) / total : 0;
      return {
        passed: defaultPct < 10,
        summary: `rows=${rows.length}, default_pct=${defaultPct.toFixed(1)}%`,
      };
    },
  },
  {
    id: '1.4.a',
    name: 'Capability Inference Sample (4h)',
    sql: `
SELECT agent_role, routing_capabilities, routing_rule
FROM agent_runs
WHERE created_at > NOW() - INTERVAL '4 hours'
  AND routing_capabilities IS NOT NULL
  AND array_length(routing_capabilities, 1) > 0
ORDER BY created_at DESC
LIMIT 20;`,
    evaluate: (rows) => ({
      passed: rows.length > 0,
      summary: `sample_rows=${rows.length}`,
    }),
  },
  {
    id: '1.4.b',
    name: 'frontend-engineer has code_generation',
    sql: `
SELECT routing_capabilities
FROM agent_runs
WHERE agent_role = 'frontend-engineer'
  AND created_at > NOW() - INTERVAL '24 hours'
  AND routing_capabilities IS NOT NULL
ORDER BY created_at DESC
LIMIT 3;`,
    evaluate: (rows) => {
      const has = rows.some((r) => Array.isArray(r.routing_capabilities) && r.routing_capabilities.includes('code_generation'));
      return { passed: has, summary: `rows=${rows.length}, has_code_generation=${has}` };
    },
  },
  {
    id: '1.4.c',
    name: 'research analysts have web_research',
    sql: `
SELECT agent_role, routing_capabilities
FROM agent_runs
WHERE agent_role IN ('competitive-research-analyst', 'market-research-analyst', 'technical-research-analyst')
  AND created_at > NOW() - INTERVAL '24 hours'
  AND routing_capabilities IS NOT NULL
ORDER BY created_at DESC
LIMIT 5;`,
    evaluate: (rows) => {
      const has = rows.some((r) => Array.isArray(r.routing_capabilities) && r.routing_capabilities.includes('web_research'));
      return { passed: has, summary: `rows=${rows.length}, has_web_research=${has}` };
    },
  },
  {
    id: '1.4.d',
    name: 'cfo has financial_computation',
    sql: `
SELECT routing_capabilities
FROM agent_runs
WHERE agent_role = 'cfo'
  AND created_at > NOW() - INTERVAL '24 hours'
  AND routing_capabilities IS NOT NULL
ORDER BY created_at DESC
LIMIT 3;`,
    evaluate: (rows) => {
      const has = rows.some((r) => Array.isArray(r.routing_capabilities) && r.routing_capabilities.includes('financial_computation'));
      return { passed: has, summary: `rows=${rows.length}, has_financial_computation=${has}` };
    },
  },
  {
    id: '1.4.e',
    name: 'content-creator has creative_writing',
    sql: `
SELECT routing_capabilities
FROM agent_runs
WHERE agent_role = 'content-creator'
  AND created_at > NOW() - INTERVAL '24 hours'
  AND routing_capabilities IS NOT NULL
ORDER BY created_at DESC
LIMIT 3;`,
    evaluate: (rows) => {
      const has = rows.some((r) => Array.isArray(r.routing_capabilities) && r.routing_capabilities.includes('creative_writing'));
      return { passed: has, summary: `rows=${rows.length}, has_creative_writing=${has}` };
    },
  },
  {
    id: '1.4.f',
    name: 'chief-of-staff orchestrate has orchestration',
    sql: `
SELECT routing_capabilities, task
FROM agent_runs
WHERE agent_role = 'chief-of-staff'
  AND task = 'orchestrate'
  AND created_at > NOW() - INTERVAL '24 hours'
  AND routing_capabilities IS NOT NULL
ORDER BY created_at DESC
LIMIT 3;`,
    evaluate: (rows) => {
      const has = rows.some((r) => Array.isArray(r.routing_capabilities) && r.routing_capabilities.includes('orchestration'));
      return { passed: has, summary: `rows=${rows.length}, has_orchestration=${has}` };
    },
  },
  {
    id: '1.4.g',
    name: 'ops prechecks route deterministic',
    sql: `
SELECT routing_capabilities, routing_rule, task
FROM agent_runs
WHERE agent_role = 'ops'
  AND task IN ('health_check', 'freshness_check', 'cost_check')
  AND created_at > NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC
LIMIT 5;`,
    evaluate: (rows) => {
      const has = rows.some((r) => r.routing_rule === 'deterministic_skip');
      return { passed: has, summary: `rows=${rows.length}, has_deterministic_skip=${has}` };
    },
  },
  {
    id: '1.5',
    name: 'Observation model/capability snapshot',
    sql: `
SELECT agent_role,
       array_length(routing_capabilities, 1) AS num_capabilities,
       routing_model,
       routing_rule
FROM agent_runs
WHERE created_at > NOW() - INTERVAL '4 hours'
  AND routing_rule IS NOT NULL
ORDER BY agent_role, created_at DESC;`,
    evaluate: (rows) => ({ passed: rows.length > 0, summary: `rows=${rows.length}` }),
  },
  {
    id: '1.6',
    name: 'No perf regression (before/after)',
    sql: `
WITH before AS (
  SELECT AVG(duration_ms) AS avg_ms, COUNT(*) AS runs
  FROM agent_runs
  WHERE created_at BETWEEN NOW() - INTERVAL '48 hours' AND NOW() - INTERVAL '24 hours'
    AND status = 'completed'
),
after AS (
  SELECT AVG(duration_ms) AS avg_ms, COUNT(*) AS runs
  FROM agent_runs
  WHERE created_at > NOW() - INTERVAL '24 hours'
    AND status = 'completed'
)
SELECT 'before' AS period, ROUND(avg_ms) AS avg_duration_ms, runs FROM before
UNION ALL
SELECT 'after', ROUND(avg_ms), runs FROM after;`,
    evaluate: (rows) => {
      const b = rows.find((r) => r.period === 'before');
      const a = rows.find((r) => r.period === 'after');
      const bMs = Number(b?.avg_duration_ms || 0);
      const aMs = Number(a?.avg_duration_ms || 0);
      const pct = bMs > 0 ? ((aMs - bMs) / bMs) * 100 : 0;
      return {
        passed: Math.abs(pct) <= 5,
        summary: `before=${bMs}ms, after=${aMs}ms, delta=${pct.toFixed(1)}%`,
      };
    },
  },
  {
    id: '2.1',
    name: 'Models changing (6h)',
    sql: `
SELECT routing_model,
       COUNT(*)::int AS runs,
       ROUND(AVG(cost)::numeric, 5) AS avg_cost,
       ROUND(AVG(input_tokens)) AS avg_input_tokens,
       ROUND(AVG(output_tokens)) AS avg_output_tokens
FROM agent_runs
WHERE created_at > NOW() - INTERVAL '6 hours'
  AND status IN ('completed', 'skipped_precheck')
GROUP BY routing_model
ORDER BY runs DESC;`,
    evaluate: (rows) => {
      const distinct = rows.filter((r) => r.routing_model !== null).length;
      return { passed: distinct >= 3, summary: `distinct_models=${distinct}` };
    },
  },
  {
    id: '2.2',
    name: 'Deterministic skip rates',
    sql: `
SELECT task, COUNT(*)::int AS total_runs,
       SUM(CASE WHEN status = 'skipped_precheck' THEN 1 ELSE 0 END)::int AS skipped,
       SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END)::int AS completed,
       ROUND(100.0 * SUM(CASE WHEN status = 'skipped_precheck' THEN 1 ELSE 0 END) / COUNT(*), 1) AS skip_pct
FROM agent_runs
WHERE created_at > NOW() - INTERVAL '24 hours'
  AND task IN ('health_check', 'freshness_check', 'cost_check', 'triage_queue', 'platform_health_check')
GROUP BY task
ORDER BY total_runs DESC;`,
    evaluate: (rows) => {
      const any = rows.some((r) => Number(r.skip_pct) > 0);
      return { passed: any, summary: `tasks=${rows.length}, any_skip_gt_0=${any}` };
    },
  },
  {
    id: '2.3.a',
    name: 'Code generation uses gpt-5.4',
    sql: `
SELECT agent_role, routing_rule, routing_model, task,
       input_tokens, output_tokens, cost, duration_ms
FROM agent_runs
WHERE 'code_generation' = ANY(routing_capabilities)
  AND created_at > NOW() - INTERVAL '24 hours'
  AND status = 'completed'
ORDER BY created_at DESC
LIMIT 15;`,
    evaluate: (rows) => {
      if (!rows.length) return { passed: false, summary: 'no_code_generation_runs=1' };
      const correct = rows.filter((r) => r.routing_model === 'gpt-5.4').length;
      const pct = (100 * correct) / rows.length;
      return { passed: pct >= 80, summary: `gpt54_pct=${pct.toFixed(1)}% (${correct}/${rows.length})` };
    },
  },
  {
    id: '2.3.b',
    name: 'Code quality before/after',
    sql: `
WITH before AS (
  SELECT agent_role, AVG(quality_score) AS avg_q
  FROM agent_reflections
  WHERE created_at BETWEEN NOW() - INTERVAL '7 days' AND NOW() - INTERVAL '1 day'
    AND agent_role IN ('frontend-engineer', 'template-architect', 'platform-engineer', 'devops-engineer', 'cto')
  GROUP BY agent_role
),
after AS (
  SELECT agent_role, AVG(quality_score) AS avg_q
  FROM agent_reflections
  WHERE created_at > NOW() - INTERVAL '1 day'
    AND agent_role IN ('frontend-engineer', 'template-architect', 'platform-engineer', 'devops-engineer', 'cto')
  GROUP BY agent_role
)
SELECT COALESCE(b.agent_role, a.agent_role) AS agent,
       ROUND(b.avg_q, 1) AS before_quality,
       ROUND(a.avg_q, 1) AS after_quality,
       ROUND(a.avg_q - b.avg_q, 1) AS delta
FROM before b FULL OUTER JOIN after a ON b.agent_role = a.agent_role
ORDER BY delta DESC NULLS LAST;`,
    evaluate: (rows) => {
      const deltas = rows.map((r) => Number(r.delta)).filter((n) => !Number.isNaN(n));
      const avgDelta = deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : 0;
      return { passed: avgDelta >= 0, summary: `agents=${rows.length}, avg_delta=${avgDelta.toFixed(2)}` };
    },
  },
  {
    id: '2.4',
    name: 'Claude usage role check',
    sql: `
SELECT agent_role, routing_rule, routing_model, task
FROM agent_runs
WHERE routing_model = 'claude-sonnet-4-6'
  AND created_at > NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC
LIMIT 15;`,
    evaluate: (rows) => ({ passed: rows.length > 0, summary: `rows=${rows.length}` }),
  },
  {
    id: '2.5',
    name: 'Gemini usage role check',
    sql: `
SELECT agent_role, routing_rule, routing_model
FROM agent_runs
WHERE routing_model LIKE 'gemini%'
  AND created_at > NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC
LIMIT 15;`,
    evaluate: (rows) => ({ passed: rows.length > 0, summary: `rows=${rows.length}` }),
  },
  {
    id: '2.6',
    name: 'Nano for reflection/kg/eval',
    sql: `
SELECT task, routing_model, COUNT(*)::int AS runs, ROUND(AVG(cost)::numeric, 5) AS avg_cost
FROM agent_runs
WHERE task IN ('reflection', 'kg_update', 'constitutional_eval')
  AND created_at > NOW() - INTERVAL '24 hours'
GROUP BY task, routing_model;`,
    evaluate: (rows) => {
      const nano = rows.filter((r) => r.routing_model === 'gpt-5-nano').reduce((s, r) => s + Number(r.runs), 0);
      return { passed: nano > 0, summary: `rows=${rows.length}, nano_runs=${nano}` };
    },
  },
  {
    id: '2.7',
    name: 'Revision cycle reduction',
    sql: `
WITH before AS (
  SELECT COUNT(*)::int AS revisions
  FROM work_assignments
  WHERE status = 'needs_revision'
    AND updated_at BETWEEN NOW() - INTERVAL '14 days' AND NOW() - INTERVAL '7 days'
),
after AS (
  SELECT COUNT(*)::int AS revisions
  FROM work_assignments
  WHERE status = 'needs_revision'
    AND updated_at > NOW() - INTERVAL '7 days'
)
SELECT 'before (prev week)' AS period, revisions FROM before
UNION ALL
SELECT 'after (this week)', revisions FROM after;`,
    evaluate: (rows) => {
      const b = Number((rows.find((r) => r.period === 'before (prev week)') || {}).revisions || 0);
      const a = Number((rows.find((r) => r.period === 'after (this week)') || {}).revisions || 0);
      return { passed: a <= b, summary: `before=${b}, after=${a}` };
    },
  },
  {
    id: '2.8.a',
    name: 'Daily cost trend (7d)',
    sql: `
SELECT DATE(created_at) AS day,
       COUNT(*)::int AS runs,
       SUM(CASE WHEN status = 'skipped_precheck' THEN 1 ELSE 0 END)::int AS skipped,
       ROUND(SUM(cost)::numeric, 2) AS total_cost,
       ROUND(AVG(cost)::numeric, 5) AS avg_cost_per_run
FROM agent_runs
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY DATE(created_at)
ORDER BY day;`,
    evaluate: (rows) => {
      const latest = rows[rows.length - 1];
      const cost = Number(latest?.total_cost || 0);
      return { passed: cost <= 1.3, summary: `latest_day_cost=${cost.toFixed(2)}` };
    },
  },
  {
    id: '2.8.b',
    name: '24h cost by model',
    sql: `
SELECT routing_model, COUNT(*)::int AS runs, ROUND(SUM(cost)::numeric, 2) AS total_cost
FROM agent_runs
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY routing_model
ORDER BY total_cost DESC;`,
    evaluate: (rows) => ({ passed: rows.length > 0, summary: `models=${rows.length}` }),
  },
  {
    id: '3.1',
    name: 'Apply patch reduces output tokens',
    sql: `
SELECT
  CASE WHEN created_at < NOW() - INTERVAL '3 days' THEN 'before' ELSE 'after' END AS period,
  COUNT(*)::int AS runs,
  ROUND(AVG(output_tokens)) AS avg_output_tokens,
  ROUND(AVG(input_tokens)) AS avg_input_tokens
FROM agent_runs
WHERE 'code_generation' = ANY(routing_capabilities)
  AND status = 'completed'
  AND created_at > NOW() - INTERVAL '7 days'
GROUP BY 1
ORDER BY 1;`,
    evaluate: (rows) => {
      const b = Number((rows.find((r) => r.period === 'before') || {}).avg_output_tokens || 0);
      const a = Number((rows.find((r) => r.period === 'after') || {}).avg_output_tokens || 0);
      const drop = b > 0 ? ((b - a) / b) * 100 : 0;
      return { passed: drop >= 40, summary: `before=${b}, after=${a}, drop=${drop.toFixed(1)}%` };
    },
  },
  {
    id: '3.2',
    name: 'Tool search reduces input tokens',
    sql: `
SELECT
  CASE WHEN created_at < NOW() - INTERVAL '3 days' THEN 'before' ELSE 'after' END AS period,
  COUNT(*)::int AS runs,
  ROUND(AVG(input_tokens)) AS avg_input_tokens
FROM agent_runs
WHERE routing_rule IN ('orchestration', 'standard_code_gen', 'many_tools_non_code')
  AND status = 'completed'
  AND created_at > NOW() - INTERVAL '7 days'
GROUP BY 1
ORDER BY 1;`,
    evaluate: (rows) => {
      const b = Number((rows.find((r) => r.period === 'before') || {}).avg_input_tokens || 0);
      const a = Number((rows.find((r) => r.period === 'after') || {}).avg_input_tokens || 0);
      const drop = b > 0 ? ((b - a) / b) * 100 : 0;
      return { passed: drop >= 30, summary: `before=${b}, after=${a}, drop=${drop.toFixed(1)}%` };
    },
  },
  {
    id: '3.3',
    name: 'MCP filtering token reduction',
    sql: `
SELECT agent_role,
  CASE WHEN created_at < NOW() - INTERVAL '3 days' THEN 'before' ELSE 'after' END AS period,
  ROUND(AVG(input_tokens)) AS avg_input_tokens,
  COUNT(*)::int AS runs
FROM agent_runs
WHERE agent_role IN ('competitive-research-analyst', 'support-triage', 'seo-analyst', 'onboarding-specialist')
  AND status = 'completed'
  AND created_at > NOW() - INTERVAL '7 days'
GROUP BY agent_role, 2
ORDER BY agent_role, 2;`,
    evaluate: (rows) => ({ passed: rows.length > 0, summary: `rows=${rows.length}` }),
  },
  {
    id: '3.4',
    name: 'Prompt caching proxy check',
    sql: `
SELECT agent_role, COUNT(*)::int AS runs,
       ROUND(AVG(input_tokens)) AS avg_input,
       MIN(input_tokens)::int AS min_input,
       MAX(input_tokens)::int AS max_input
FROM agent_runs
WHERE created_at > NOW() - INTERVAL '12 hours'
  AND routing_model LIKE 'gpt-5%'
  AND status = 'completed'
GROUP BY agent_role
HAVING COUNT(*) >= 3
ORDER BY avg_input;`,
    evaluate: (rows) => ({ passed: rows.length > 0, summary: `agents=${rows.length}` }),
  },
  {
    id: '3.5',
    name: 'Structured outputs reflection rate',
    sql: `
SELECT COUNT(*)::int AS total_runs,
       COUNT(r.id)::int AS runs_with_reflections,
       (COUNT(*) - COUNT(r.id))::int AS missing_reflections,
       ROUND(100.0 * COUNT(r.id) / NULLIF(COUNT(*), 0), 1) AS reflection_rate_pct
FROM agent_runs ar
LEFT JOIN agent_reflections r ON r.run_id = ar.id
WHERE ar.created_at > NOW() - INTERVAL '24 hours'
  AND ar.status = 'completed'
  AND ar.task NOT IN ('on_demand', 'reflection');`,
    evaluate: (rows) => {
      const pct = Number((rows[0] || {}).reflection_rate_pct || 0);
      return { passed: pct >= 95, summary: `reflection_rate_pct=${pct}` };
    },
  },
  {
    id: '3.6.a',
    name: 'Constitutional evaluations active',
    sql: `
SELECT agent_role, COUNT(*)::int AS evals,
       ROUND(AVG((evaluation->>'compliance_score')::numeric), 2) AS avg_compliance
FROM constitutional_evaluations
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY agent_role
ORDER BY avg_compliance;`,
    evaluate: (rows) => {
      const hasAny = rows.length > 0;
      const min = rows.reduce((m, r) => Math.min(m, Number(r.avg_compliance || 1)), 1);
      return { passed: hasAny && min > 0.7, summary: `rows=${rows.length}, min_compliance=${min.toFixed(2)}` };
    },
  },
  {
    id: '3.6.b',
    name: 'Trust scores updating',
    sql: `
SELECT agent_role, trust_score, last_updated
FROM agent_trust_scores
WHERE last_updated > NOW() - INTERVAL '24 hours'
ORDER BY trust_score;`,
    evaluate: (rows) => ({ passed: rows.length > 0, summary: `rows=${rows.length}` }),
  },
  {
    id: '3.6.c',
    name: 'Budget/formal verify audit signals',
    sql: `
SELECT agent_role, action, response_code, created_at
FROM platform_audit_log
WHERE action LIKE '%budget%' OR action LIKE '%formal_verify%'
  AND created_at > NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC
LIMIT 10;`,
    evaluate: (rows) => ({ passed: rows.length > 0, summary: `rows=${rows.length}` }),
  },
  {
    id: '3.7',
    name: 'Abort rate before/after',
    sql: `
SELECT
  CASE WHEN created_at < NOW() - INTERVAL '7 days' THEN 'before' ELSE 'after' END AS period,
  COUNT(*)::int AS total,
  SUM(CASE WHEN status = 'aborted' THEN 1 ELSE 0 END)::int AS aborted,
  ROUND(100.0 * SUM(CASE WHEN status = 'aborted' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 1) AS abort_pct
FROM agent_runs
WHERE created_at > NOW() - INTERVAL '14 days'
  AND status != 'skipped_precheck'
GROUP BY 1
ORDER BY 1;`,
    evaluate: (rows) => {
      const b = Number((rows.find((r) => r.period === 'before') || {}).abort_pct || 0);
      const a = Number((rows.find((r) => r.period === 'after') || {}).abort_pct || 0);
      return { passed: a < b && a < 10, summary: `before=${b}%, after=${a}%` };
    },
  },
  {
    id: 'D1',
    name: 'Wrong model scan sample',
    sql: `
SELECT agent_role, task, routing_model, routing_rule, routing_capabilities
FROM agent_runs
WHERE created_at > NOW() - INTERVAL '4 hours'
  AND routing_model IS NOT NULL
ORDER BY created_at DESC
LIMIT 30;`,
    evaluate: (rows) => ({ passed: rows.length > 0, summary: `rows=${rows.length}` }),
  },
  {
    id: 'D2',
    name: 'Capabilities by agent',
    sql: `
SELECT agent_role,
       unnest(routing_capabilities) AS capability,
       COUNT(*)::int AS frequency
FROM agent_runs
WHERE created_at > NOW() - INTERVAL '24 hours'
  AND routing_capabilities IS NOT NULL
GROUP BY agent_role, capability
ORDER BY agent_role, frequency DESC;`,
    evaluate: (rows) => ({ passed: rows.length > 0, summary: `rows=${rows.length}` }),
  },
  {
    id: 'D3',
    name: 'Cost per model tier',
    sql: `
SELECT routing_model,
       COUNT(*)::int AS runs,
       ROUND(SUM(cost)::numeric, 2) AS total_cost,
       ROUND(SUM(cost)::numeric / NULLIF(COUNT(*), 0), 5) AS cost_per_run,
       ROUND(SUM(input_tokens)::numeric / 1000000, 2) AS total_input_mtok,
       ROUND(SUM(output_tokens)::numeric / 1000000, 2) AS total_output_mtok
FROM agent_runs
WHERE created_at > NOW() - INTERVAL '24 hours'
  AND routing_model IS NOT NULL
GROUP BY routing_model
ORDER BY total_cost DESC;`,
    evaluate: (rows) => ({ passed: rows.length > 0, summary: `models=${rows.length}` }),
  },
  {
    id: 'D4',
    name: 'Routing rule hit map',
    sql: `
SELECT routing_rule, COUNT(*)::int AS hits,
       ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct
FROM agent_runs
WHERE created_at > NOW() - INTERVAL '24 hours'
  AND routing_rule IS NOT NULL
GROUP BY routing_rule
ORDER BY hits DESC;`,
    evaluate: (rows) => {
      const defaultRow = rows.find((r) => r.routing_rule === 'default');
      const defaultPct = Number(defaultRow?.pct || 0);
      return { passed: defaultPct < 5, summary: `default_pct=${defaultPct}%` };
    },
  },
  {
    id: 'D5',
    name: 'Token savings summary week-over-week',
    sql: `
SELECT
  CASE WHEN created_at > NOW() - INTERVAL '7 days' THEN 'this_week' ELSE 'last_week' END AS period,
  COUNT(*)::int AS runs,
  ROUND(SUM(input_tokens)::numeric / 1000000, 2) AS total_input_mtok,
  ROUND(SUM(output_tokens)::numeric / 1000000, 2) AS total_output_mtok,
  ROUND(SUM(cost)::numeric, 2) AS total_cost,
  ROUND(AVG(input_tokens)) AS avg_input_per_run,
  ROUND(AVG(output_tokens)) AS avg_output_per_run
FROM agent_runs
WHERE created_at > NOW() - INTERVAL '14 days'
  AND status IN ('completed', 'skipped_precheck')
GROUP BY 1
ORDER BY 1;`,
    evaluate: (rows) => {
      const lw = rows.find((r) => r.period === 'last_week');
      const tw = rows.find((r) => r.period === 'this_week');
      const lwIn = Number(lw?.avg_input_per_run || 0);
      const twIn = Number(tw?.avg_input_per_run || 0);
      const drop = lwIn > 0 ? ((lwIn - twIn) / lwIn) * 100 : 0;
      return { passed: drop >= 20, summary: `avg_input_drop=${drop.toFixed(1)}%` };
    },
  },
];

async function run() {
  const c = new Client({ connectionString });
  await c.connect();

  const started = new Date();
  const results = [];
  const details = {};

  for (const t of tests) {
    try {
      const q = await c.query(t.sql);
      const evalResult = t.evaluate(q.rows || []);
      results.push({
        id: t.id,
        name: t.name,
        status: evalResult.passed ? 'PASS' : 'FAIL',
        summary: evalResult.summary,
        rowCount: q.rowCount,
      });
      details[t.id] = q.rows;
    } catch (e) {
      results.push({
        id: t.id,
        name: t.name,
        status: 'ERROR',
        summary: e.message,
        rowCount: 0,
      });
      details[t.id] = { error: e.message };
    }
  }

  const finished = new Date();
  const report = {
    startedAt: started.toISOString(),
    finishedAt: finished.toISOString(),
    durationMs: finished - started,
    connectionHost: connectionString,
    totals: {
      pass: results.filter((r) => r.status === 'PASS').length,
      fail: results.filter((r) => r.status === 'FAIL').length,
      error: results.filter((r) => r.status === 'ERROR').length,
      all: results.length,
    },
    results,
    details,
  };

  console.log(JSON.stringify(report, null, 2));
  await c.end();
}

run().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
