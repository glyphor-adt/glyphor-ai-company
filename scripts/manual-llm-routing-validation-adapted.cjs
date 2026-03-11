const { Client } = require('pg');

const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://glyphor_system_user:lGHMxoC8zpmngKUaYv9cOTwJ@136.111.200.6:5432/glyphor';

function ok(passed, summary) {
  return { passed, summary };
}

const tests = [
  {
    id: '1.1',
    name: 'Routing Columns Exist',
    sql: `SELECT column_name, data_type
          FROM information_schema.columns
          WHERE table_name = 'agent_runs'
            AND column_name IN ('routing_rule', 'routing_capabilities', 'routing_model')
          ORDER BY column_name;`,
    eval: (rows) => ok(rows.length === 3, `columns_found=${rows.length}`),
  },
  {
    id: '1.2',
    name: 'Routing Data Logged (1h)',
    sql: `SELECT COUNT(*)::int AS total_runs,
                 COUNT(routing_rule)::int AS runs_with_routing,
                 (COUNT(*) - COUNT(routing_rule))::int AS runs_without_routing
          FROM agent_runs
          WHERE created_at > NOW() - INTERVAL '1 hour';`,
    eval: ([r]) => ok(Number(r.runs_without_routing) === 0, `total=${r.total_runs}, with=${r.runs_with_routing}, without=${r.runs_without_routing}`),
  },
  {
    id: '1.3',
    name: 'Routing Rule Distribution (4h)',
    sql: `SELECT routing_rule, routing_model, COUNT(*)::int AS runs
          FROM agent_runs
          WHERE created_at > NOW() - INTERVAL '4 hours'
            AND routing_rule IS NOT NULL
          GROUP BY routing_rule, routing_model
          ORDER BY runs DESC;`,
    eval: (rows) => {
      const total = rows.reduce((s, x) => s + Number(x.runs), 0);
      const d = rows.find((x) => x.routing_rule === 'default');
      const dp = total ? (100 * Number(d?.runs || 0)) / total : 0;
      return ok(dp < 10, `rules=${rows.length}, default_pct=${dp.toFixed(1)}%`);
    },
  },
  {
    id: '1.4.a',
    name: 'Capability Inference Sample',
    sql: `SELECT agent_id AS agent_role, routing_capabilities, routing_rule
          FROM agent_runs
          WHERE created_at > NOW() - INTERVAL '4 hours'
            AND routing_capabilities IS NOT NULL
            AND array_length(routing_capabilities, 1) > 0
          ORDER BY created_at DESC
          LIMIT 20;`,
    eval: (rows) => ok(rows.length > 0, `sample_rows=${rows.length}`),
  },
  {
    id: '1.4.b',
    name: 'frontend-engineer has code_generation',
    sql: `SELECT routing_capabilities
          FROM agent_runs
          WHERE agent_id = 'frontend-engineer'
            AND created_at > NOW() - INTERVAL '24 hours'
            AND routing_capabilities IS NOT NULL
          ORDER BY created_at DESC
          LIMIT 3;`,
    eval: (rows) => ok(rows.some((r) => r.routing_capabilities?.includes('code_generation')), `rows=${rows.length}`),
  },
  {
    id: '1.4.c',
    name: 'research analysts have web_research',
    sql: `SELECT agent_id AS agent_role, routing_capabilities
          FROM agent_runs
          WHERE agent_id IN ('competitive-research-analyst', 'market-research-analyst', 'technical-research-analyst')
            AND created_at > NOW() - INTERVAL '24 hours'
            AND routing_capabilities IS NOT NULL
          ORDER BY created_at DESC
          LIMIT 5;`,
    eval: (rows) => ok(rows.some((r) => r.routing_capabilities?.includes('web_research')), `rows=${rows.length}`),
  },
  {
    id: '1.4.d',
    name: 'cfo has financial_computation',
    sql: `SELECT routing_capabilities
          FROM agent_runs
          WHERE agent_id = 'cfo'
            AND created_at > NOW() - INTERVAL '24 hours'
            AND routing_capabilities IS NOT NULL
          ORDER BY created_at DESC
          LIMIT 3;`,
    eval: (rows) => ok(rows.some((r) => r.routing_capabilities?.includes('financial_computation')), `rows=${rows.length}`),
  },
  {
    id: '1.4.e',
    name: 'content-creator has creative_writing',
    sql: `SELECT routing_capabilities
          FROM agent_runs
          WHERE agent_id = 'content-creator'
            AND created_at > NOW() - INTERVAL '24 hours'
            AND routing_capabilities IS NOT NULL
          ORDER BY created_at DESC
          LIMIT 3;`,
    eval: (rows) => ok(rows.some((r) => r.routing_capabilities?.includes('creative_writing')), `rows=${rows.length}`),
  },
  {
    id: '1.4.f',
    name: 'chief-of-staff orchestrate has orchestration',
    sql: `SELECT routing_capabilities, task
          FROM agent_runs
          WHERE agent_id = 'chief-of-staff'
            AND task = 'orchestrate'
            AND created_at > NOW() - INTERVAL '24 hours'
            AND routing_capabilities IS NOT NULL
          ORDER BY created_at DESC
          LIMIT 3;`,
    eval: (rows) => ok(rows.some((r) => r.routing_capabilities?.includes('orchestration')), `rows=${rows.length}`),
  },
  {
    id: '1.4.g',
    name: 'ops prechecks deterministic',
    sql: `SELECT routing_capabilities, routing_rule, task
          FROM agent_runs
          WHERE agent_id = 'ops'
            AND task IN ('health_check', 'freshness_check', 'cost_check')
            AND created_at > NOW() - INTERVAL '24 hours'
          ORDER BY created_at DESC
          LIMIT 5;`,
    eval: (rows) => ok(rows.some((r) => r.routing_rule === 'deterministic_skip'), `rows=${rows.length}`),
  },
  {
    id: '1.6',
    name: 'No performance regression (<=5%)',
    sql: `WITH before AS (
            SELECT AVG(duration_ms) AS avg_ms
            FROM agent_runs
            WHERE created_at BETWEEN NOW() - INTERVAL '48 hours' AND NOW() - INTERVAL '24 hours'
              AND status = 'completed'
          ),
          after AS (
            SELECT AVG(duration_ms) AS avg_ms
            FROM agent_runs
            WHERE created_at > NOW() - INTERVAL '24 hours'
              AND status = 'completed'
          )
          SELECT ROUND((SELECT avg_ms FROM before))::int AS before_ms,
                 ROUND((SELECT avg_ms FROM after))::int AS after_ms;`,
    eval: ([r]) => {
      const before = Number(r.before_ms || 0);
      const after = Number(r.after_ms || 0);
      const pct = before ? ((after - before) / before) * 100 : 0;
      return ok(Math.abs(pct) <= 5, `before=${before}ms, after=${after}ms, delta=${pct.toFixed(1)}%`);
    },
  },
  {
    id: '2.1',
    name: 'Models are changing (6h)',
    sql: `SELECT routing_model, COUNT(*)::int AS runs
          FROM agent_runs
          WHERE created_at > NOW() - INTERVAL '6 hours'
            AND status IN ('completed', 'skipped_precheck')
          GROUP BY routing_model
          ORDER BY runs DESC;`,
    eval: (rows) => ok(rows.filter((r) => r.routing_model).length >= 3, `distinct=${rows.filter((r) => r.routing_model).length}`),
  },
  {
    id: '2.2',
    name: 'Deterministic pre-check skips',
    sql: `SELECT task, COUNT(*)::int AS total_runs,
                 SUM(CASE WHEN status = 'skipped_precheck' THEN 1 ELSE 0 END)::int AS skipped,
                 ROUND(100.0 * SUM(CASE WHEN status = 'skipped_precheck' THEN 1 ELSE 0 END) / COUNT(*), 1) AS skip_pct
          FROM agent_runs
          WHERE created_at > NOW() - INTERVAL '24 hours'
            AND task IN ('health_check', 'freshness_check', 'cost_check', 'triage_queue', 'platform_health_check')
          GROUP BY task
          ORDER BY total_runs DESC;`,
    eval: (rows) => ok(rows.some((r) => Number(r.skip_pct) > 0), `tasks=${rows.length}`),
  },
  {
    id: '2.3.a',
    name: 'Code generation on gpt-5.4',
    sql: `SELECT routing_model
          FROM agent_runs
          WHERE 'code_generation' = ANY(routing_capabilities)
            AND created_at > NOW() - INTERVAL '24 hours'
            AND status = 'completed';`,
    eval: (rows) => {
      if (!rows.length) return ok(false, 'no_code_generation_rows');
      const correct = rows.filter((r) => r.routing_model === 'gpt-5.4').length;
      const pct = (100 * correct) / rows.length;
      return ok(pct >= 80, `pct=${pct.toFixed(1)}% (${correct}/${rows.length})`);
    },
  },
  {
    id: '2.3.b',
    name: 'Code quality before/after',
    sql: `WITH before AS (
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
          FROM before b FULL OUTER JOIN after a ON b.agent_role = a.agent_role;`,
    eval: (rows) => {
      const deltas = rows.map((r) => Number(r.delta)).filter((n) => !Number.isNaN(n));
      const avg = deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : 0;
      return ok(avg >= 0, `agents=${rows.length}, avg_delta=${avg.toFixed(2)}`);
    },
  },
  {
    id: '2.4',
    name: 'Claude usage present',
    sql: `SELECT agent_id, routing_rule, task
          FROM agent_runs
          WHERE routing_model = 'claude-sonnet-4-6'
            AND created_at > NOW() - INTERVAL '24 hours'
          LIMIT 15;`,
    eval: (rows) => ok(rows.length > 0, `rows=${rows.length}`),
  },
  {
    id: '2.5',
    name: 'Gemini usage present',
    sql: `SELECT agent_id, routing_rule, routing_model
          FROM agent_runs
          WHERE routing_model LIKE 'gemini%'
            AND created_at > NOW() - INTERVAL '24 hours'
          LIMIT 15;`,
    eval: (rows) => ok(rows.length > 0, `rows=${rows.length}`),
  },
  {
    id: '2.6',
    name: 'Nano for reflection/kg/eval',
    sql: `SELECT task, routing_model, COUNT(*)::int AS runs
          FROM agent_runs
          WHERE task IN ('reflection', 'kg_update', 'constitutional_eval')
            AND created_at > NOW() - INTERVAL '24 hours'
          GROUP BY task, routing_model;`,
    eval: (rows) => {
      const nanoRuns = rows.filter((r) => r.routing_model === 'gpt-5-nano').reduce((s, r) => s + Number(r.runs), 0);
      return ok(nanoRuns > 0, `rows=${rows.length}, nano_runs=${nanoRuns}`);
    },
  },
  {
    id: '2.7',
    name: 'Revision cycle reduction',
    sql: `WITH before AS (
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
          SELECT (SELECT revisions FROM before) AS before_rev,
                 (SELECT revisions FROM after) AS after_rev;`,
    eval: ([r]) => ok(Number(r.after_rev) <= Number(r.before_rev), `before=${r.before_rev}, after=${r.after_rev}`),
  },
  {
    id: '2.8',
    name: 'Daily cost under control (latest day <= 1.30)',
    sql: `SELECT DATE(created_at) AS day,
                 ROUND(SUM(cost)::numeric, 2) AS total_cost
          FROM agent_runs
          WHERE created_at > NOW() - INTERVAL '7 days'
          GROUP BY DATE(created_at)
          ORDER BY day;`,
    eval: (rows) => {
      const latest = rows[rows.length - 1];
      const c = Number(latest?.total_cost || 0);
      return ok(c <= 1.3, `latest_day=${latest?.day || 'n/a'}, cost=${c.toFixed(2)}`);
    },
  },
  {
    id: '3.1',
    name: 'Apply patch reduces output tokens',
    sql: `SELECT CASE WHEN created_at < NOW() - INTERVAL '3 days' THEN 'before' ELSE 'after' END AS period,
                 ROUND(AVG(output_tokens))::int AS avg_output
          FROM agent_runs
          WHERE 'code_generation' = ANY(routing_capabilities)
            AND status = 'completed'
            AND created_at > NOW() - INTERVAL '7 days'
          GROUP BY 1;`,
    eval: (rows) => {
      const b = Number((rows.find((r) => r.period === 'before') || {}).avg_output || 0);
      const a = Number((rows.find((r) => r.period === 'after') || {}).avg_output || 0);
      const drop = b ? ((b - a) / b) * 100 : 0;
      return ok(drop >= 40, `before=${b}, after=${a}, drop=${drop.toFixed(1)}%`);
    },
  },
  {
    id: '3.2',
    name: 'Tool search reduces input tokens',
    sql: `SELECT CASE WHEN created_at < NOW() - INTERVAL '3 days' THEN 'before' ELSE 'after' END AS period,
                 ROUND(AVG(input_tokens))::int AS avg_input
          FROM agent_runs
          WHERE routing_rule IN ('orchestration', 'standard_code_gen', 'many_tools_non_code')
            AND status = 'completed'
            AND created_at > NOW() - INTERVAL '7 days'
          GROUP BY 1;`,
    eval: (rows) => {
      const b = Number((rows.find((r) => r.period === 'before') || {}).avg_input || 0);
      const a = Number((rows.find((r) => r.period === 'after') || {}).avg_input || 0);
      const drop = b ? ((b - a) / b) * 100 : 0;
      return ok(drop >= 30, `before=${b}, after=${a}, drop=${drop.toFixed(1)}%`);
    },
  },
  {
    id: '3.3',
    name: 'MCP filtering token reduction',
    sql: `SELECT agent_id,
                 CASE WHEN created_at < NOW() - INTERVAL '3 days' THEN 'before' ELSE 'after' END AS period,
                 ROUND(AVG(input_tokens))::int AS avg_input,
                 COUNT(*)::int AS runs
          FROM agent_runs
          WHERE agent_id IN ('competitive-research-analyst', 'support-triage', 'seo-analyst', 'onboarding-specialist')
            AND status = 'completed'
            AND created_at > NOW() - INTERVAL '7 days'
          GROUP BY agent_id, 2
          ORDER BY agent_id, 2;`,
    eval: (rows) => ok(rows.length > 0, `rows=${rows.length}`),
  },
  {
    id: '3.4',
    name: 'Prompt caching proxy check',
    sql: `SELECT agent_id,
                 COUNT(*)::int AS runs,
                 ROUND(AVG(input_tokens))::int AS avg_input,
                 MIN(input_tokens)::int AS min_input,
                 MAX(input_tokens)::int AS max_input
          FROM agent_runs
          WHERE created_at > NOW() - INTERVAL '12 hours'
            AND routing_model LIKE 'gpt-5%'
            AND status = 'completed'
          GROUP BY agent_id
          HAVING COUNT(*) >= 3
          ORDER BY avg_input;`,
    eval: (rows) => ok(rows.length > 0, `agents=${rows.length}`),
  },
  {
    id: '3.5',
    name: 'Structured outputs reflection rate',
    sql: `SELECT COUNT(*)::int AS total_runs,
                 COUNT(r.id)::int AS runs_with_reflections,
                 ROUND(100.0 * COUNT(r.id) / NULLIF(COUNT(*), 0), 1) AS reflection_rate_pct
          FROM agent_runs ar
          LEFT JOIN agent_reflections r ON r.run_id = ar.id::text
          WHERE ar.created_at > NOW() - INTERVAL '24 hours'
            AND ar.status = 'completed'
            AND ar.task NOT IN ('on_demand', 'reflection');`,
    eval: ([r]) => ok(Number(r.reflection_rate_pct) >= 95, `reflection_rate_pct=${r.reflection_rate_pct}`),
  },
  {
    id: '3.6.a',
    name: 'Constitutional evaluations active',
    sql: `SELECT agent_role, COUNT(*)::int AS evals,
                 ROUND(AVG(overall_adherence)::numeric, 2) AS avg_compliance
          FROM constitutional_evaluations
          WHERE evaluated_at > NOW() - INTERVAL '24 hours'
          GROUP BY agent_role
          ORDER BY avg_compliance;`,
    eval: (rows) => {
      const min = rows.length ? Math.min(...rows.map((r) => Number(r.avg_compliance || 1))) : 0;
      return ok(rows.length > 0 && min > 0.7, `rows=${rows.length}, min=${min.toFixed(2)}`);
    },
  },
  {
    id: '3.6.b',
    name: 'Trust scores updating',
    sql: `SELECT agent_role, trust_score, updated_at
          FROM agent_trust_scores
          WHERE updated_at > NOW() - INTERVAL '24 hours'
          ORDER BY trust_score;`,
    eval: (rows) => ok(rows.length > 0, `rows=${rows.length}`),
  },
  {
    id: '3.6.c',
    name: 'Budget/formal verify audit logs',
    sql: `SELECT agent_role, action, response_code, timestamp
          FROM platform_audit_log
          WHERE (action LIKE '%budget%' OR action LIKE '%formal_verify%')
            AND timestamp > NOW() - INTERVAL '24 hours'
          ORDER BY timestamp DESC
          LIMIT 10;`,
    eval: (rows) => ok(rows.length > 0, `rows=${rows.length}`),
  },
  {
    id: '3.7',
    name: 'Abort rate improved and <10%',
    sql: `SELECT CASE WHEN created_at < NOW() - INTERVAL '7 days' THEN 'before' ELSE 'after' END AS period,
                 ROUND(100.0 * SUM(CASE WHEN status = 'aborted' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 1) AS abort_pct
          FROM agent_runs
          WHERE created_at > NOW() - INTERVAL '14 days'
            AND status != 'skipped_precheck'
          GROUP BY 1;`,
    eval: (rows) => {
      const b = Number((rows.find((r) => r.period === 'before') || {}).abort_pct || 0);
      const a = Number((rows.find((r) => r.period === 'after') || {}).abort_pct || 0);
      return ok(a < b && a < 10, `before=${b}%, after=${a}%`);
    },
  },
  {
    id: 'D3',
    name: 'Cost per model tier',
    sql: `SELECT routing_model,
                 COUNT(*)::int AS runs,
                 ROUND(SUM(cost)::numeric, 2) AS total_cost,
                 ROUND(SUM(cost)::numeric / NULLIF(COUNT(*), 0), 5) AS cost_per_run
          FROM agent_runs
          WHERE created_at > NOW() - INTERVAL '24 hours'
            AND routing_model IS NOT NULL
          GROUP BY routing_model
          ORDER BY total_cost DESC;`,
    eval: (rows) => ok(rows.length > 0, `models=${rows.length}`),
  },
  {
    id: 'D4',
    name: 'Routing rule hit map (default <5%)',
    sql: `SELECT routing_rule, COUNT(*)::int AS hits,
                 ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct
          FROM agent_runs
          WHERE created_at > NOW() - INTERVAL '24 hours'
            AND routing_rule IS NOT NULL
          GROUP BY routing_rule
          ORDER BY hits DESC;`,
    eval: (rows) => {
      const d = rows.find((r) => r.routing_rule === 'default');
      const dp = Number(d?.pct || 0);
      return ok(dp < 5, `default_pct=${dp}%`);
    },
  },
  {
    id: 'D5',
    name: 'Token savings week-over-week',
    sql: `SELECT CASE WHEN created_at > NOW() - INTERVAL '7 days' THEN 'this_week' ELSE 'last_week' END AS period,
                 ROUND(AVG(input_tokens))::int AS avg_input,
                 ROUND(AVG(output_tokens))::int AS avg_output,
                 ROUND(SUM(cost)::numeric, 2) AS total_cost
          FROM agent_runs
          WHERE created_at > NOW() - INTERVAL '14 days'
            AND status IN ('completed', 'skipped_precheck')
          GROUP BY 1
          ORDER BY 1;`,
    eval: (rows) => {
      const lw = Number((rows.find((r) => r.period === 'last_week') || {}).avg_input || 0);
      const tw = Number((rows.find((r) => r.period === 'this_week') || {}).avg_input || 0);
      const drop = lw ? ((lw - tw) / lw) * 100 : 0;
      return ok(drop >= 20, `input_drop=${drop.toFixed(1)}%`);
    },
  },
];

async function run() {
  const c = new Client({ connectionString });
  await c.connect();

  const report = {
    startedAt: new Date().toISOString(),
    results: [],
    details: {},
  };

  for (const t of tests) {
    try {
      const q = await c.query(t.sql);
      const e = t.eval(q.rows);
      report.results.push({
        id: t.id,
        name: t.name,
        status: e.passed ? 'PASS' : 'FAIL',
        summary: e.summary,
        rowCount: q.rowCount,
      });
      report.details[t.id] = q.rows;
    } catch (err) {
      report.results.push({
        id: t.id,
        name: t.name,
        status: 'ERROR',
        summary: err.message,
        rowCount: 0,
      });
      report.details[t.id] = { error: err.message };
    }
  }

  const pass = report.results.filter((r) => r.status === 'PASS').length;
  const fail = report.results.filter((r) => r.status === 'FAIL').length;
  const error = report.results.filter((r) => r.status === 'ERROR').length;

  report.totals = { pass, fail, error, all: report.results.length };
  report.finishedAt = new Date().toISOString();

  console.log(JSON.stringify(report, null, 2));
  await c.end();
}

run().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
