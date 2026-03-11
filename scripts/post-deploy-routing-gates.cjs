const { Client } = require('pg');

const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://glyphor_system_user:lGHMxoC8zpmngKUaYv9cOTwJ@136.111.200.6:5432/glyphor';

const THRESHOLDS = {
  minReflectionLinksLastHour: 1,
  minDeterministicSkipsLast24h: 1,
  maxGpt54AvgInputLast2h: 30000,
};

async function run() {
  const client = new Client({ connectionString });
  await client.connect();

  const startedAt = new Date().toISOString();

  const qReflection = `
    SELECT r.id, r.run_id, ar.id AS agent_run_id
    FROM agent_reflections r
    JOIN agent_runs ar ON r.run_id::text = ar.id::text
    WHERE r.created_at > NOW() - INTERVAL '1 hour'
    LIMIT 5;
  `;

  const qDeterministic = `
    SELECT COALESCE(routing_rule, '__null__') AS routing_rule, COUNT(*)::int AS runs
    FROM agent_runs
    WHERE task IN (
      'health_check',
      'freshness_check',
      'cost_check',
      'daily_cost_check',
      'triage_queue',
      'platform_health_check'
    )
      AND created_at > NOW() - INTERVAL '24 hours'
    GROUP BY COALESCE(routing_rule, '__null__')
    ORDER BY runs DESC;
  `;

  const qGpt54 = `
    SELECT ROUND(AVG(input_tokens))::int AS avg_input,
           ROUND(AVG(output_tokens))::int AS avg_output,
           COUNT(*)::int AS runs
    FROM agent_runs
    WHERE routing_model = 'gpt-5.4'
      AND created_at > NOW() - INTERVAL '2 hours'
      AND status = 'completed';
  `;

  const rReflection = await client.query(qReflection);
  const rDeterministic = await client.query(qDeterministic);
  const rGpt54 = await client.query(qGpt54);

  await client.end();

  const linkedReflections = rReflection.rows.length;
  const deterministicSkipRow = rDeterministic.rows.find((x) => x.routing_rule === 'deterministic_skip');
  const deterministicSkips = Number(deterministicSkipRow?.runs || 0);
  const gpt54AvgInput = Number(rGpt54.rows[0]?.avg_input || 0);
  const gpt54Runs = Number(rGpt54.rows[0]?.runs || 0);

  const checks = [
    {
      id: 'reflection_uuid_linkage',
      passed: linkedReflections >= THRESHOLDS.minReflectionLinksLastHour,
      metric: linkedReflections,
      threshold: `>= ${THRESHOLDS.minReflectionLinksLastHour}`,
      note: 'Joined agent_reflections.run_id to agent_runs.id in last hour',
    },
    {
      id: 'deterministic_precheck_activity',
      passed: deterministicSkips >= THRESHOLDS.minDeterministicSkipsLast24h,
      metric: deterministicSkips,
      threshold: `>= ${THRESHOLDS.minDeterministicSkipsLast24h}`,
      note: 'Count of deterministic_skip in pre-check task family (24h)',
    },
    {
      id: 'gpt54_input_token_ceiling',
      passed: gpt54Runs === 0 ? false : gpt54AvgInput <= THRESHOLDS.maxGpt54AvgInputLast2h,
      metric: gpt54AvgInput,
      threshold: `<= ${THRESHOLDS.maxGpt54AvgInputLast2h}`,
      note: gpt54Runs === 0
        ? 'No gpt-5.4 completed runs in 2h window'
        : `Average input tokens across ${gpt54Runs} gpt-5.4 completed runs`,
    },
  ];

  const totals = {
    pass: checks.filter((c) => c.passed).length,
    fail: checks.filter((c) => !c.passed).length,
    all: checks.length,
  };

  const output = {
    startedAt,
    finishedAt: new Date().toISOString(),
    thresholds: THRESHOLDS,
    checks,
    evidence: {
      reflection_links_sample: rReflection.rows,
      deterministic_distribution: rDeterministic.rows,
      gpt54_window_summary: rGpt54.rows[0] || null,
    },
    totals,
  };

  console.log(JSON.stringify(output, null, 2));
}

run().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
