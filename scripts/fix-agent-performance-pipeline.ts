import { closePool, systemQuery } from '@glyphor/shared/db';

type Summary = {
  role: string;
  schedulesInserted: number;
  perfRowsBefore: number;
  perfRowsAfter: number;
  milestonesBefore: number;
  milestonesAfter: number;
  backfilledRows: number;
};

function getArg(name: string, fallback: string): string {
  const argv = process.argv.slice(2);
  const index = argv.indexOf(name);
  if (index === -1) return fallback;
  return argv[index + 1] ?? fallback;
}

async function ensureOpsSchedules(): Promise<number> {
  const seeds: Array<{ cron: string; task: string }> = [
    { cron: '0 */2 * * *', task: 'health_check' },
    { cron: '0 */6 * * *', task: 'freshness_check' },
    { cron: '0 */4 * * *', task: 'cost_check' },
    { cron: '0 11 * * *', task: 'morning_status' },
    { cron: '0 22 * * *', task: 'evening_status' },
    { cron: '15 6 * * *', task: 'performance_rollup' },
    { cron: '30 6 * * *', task: 'milestone_detection' },
    { cron: '45 6 * * 1', task: 'growth_update' },
  ];

  let inserted = 0;
  for (const seed of seeds) {
    const rows = await systemQuery<{ id: string }>(
      `INSERT INTO agent_schedules (agent_id, cron_expression, task, enabled)
       SELECT 'ops', $1, $2, true
       WHERE NOT EXISTS (
         SELECT 1
         FROM agent_schedules
         WHERE agent_id = 'ops'
           AND task = $2
           AND cron_expression = $1
           AND enabled = true
       )
       RETURNING id`,
      [seed.cron, seed.task],
    );
    inserted += rows.length;
  }

  return inserted;
}

async function getDecisionAgentColumn(): Promise<'agent_role' | 'proposed_by'> {
  const rows = await systemQuery<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'decisions'
         AND column_name = 'agent_role'
     ) AS exists`,
    [],
  );
  return rows[0]?.exists ? 'agent_role' : 'proposed_by';
}

async function backfillPerformance(role: string, days: number): Promise<number> {
  const start = new Date(Date.now() - days * 86400000);
  const end = new Date();
  const decisionAgentColumn = await getDecisionAgentColumn();

  const rows = await systemQuery<{ date: string }>(
    `WITH daily_runs AS (
       SELECT
         DATE(started_at) AS date,
         COUNT(*)::int AS total_runs,
         COUNT(*) FILTER (WHERE status = 'completed')::int AS successful_runs,
         COUNT(*) FILTER (WHERE status IN ('failed', 'aborted', 'skipped_precheck'))::int AS failed_runs,
         COALESCE(SUM(COALESCE(cost, 0)), 0)::numeric AS total_cost,
         AVG(duration_ms) FILTER (WHERE duration_ms IS NOT NULL)::numeric AS avg_duration_ms,
         COALESCE(SUM(COALESCE(tool_calls, 0)), 0)::int AS total_tool_calls
       FROM agent_runs
       WHERE agent_id = $1
         AND started_at >= $2
         AND started_at < $3
       GROUP BY DATE(started_at)
     ),
     daily_reflections AS (
       SELECT
         DATE(created_at) AS date,
         AVG(quality_score)::numeric AS avg_quality_score,
         MAX(quality_score)::int AS max_quality_score,
         MIN(quality_score)::int AS min_quality_score
       FROM agent_reflections
       WHERE agent_role = $1
         AND created_at >= $2
         AND created_at < $3
       GROUP BY DATE(created_at)
     ),
     daily_decisions AS (
       SELECT DATE(created_at) AS date, COUNT(*)::int AS decisions_filed
       FROM decisions
       WHERE ${decisionAgentColumn} = $1
         AND created_at >= $2
         AND created_at < $3
       GROUP BY DATE(created_at)
     ),
     daily_incidents_created AS (
       SELECT DATE(created_at) AS date, COUNT(*)::int AS incidents_created
       FROM incidents
       WHERE created_by = $1
         AND created_at >= $2
         AND created_at < $3
       GROUP BY DATE(created_at)
     ),
     daily_incidents_resolved AS (
       SELECT DATE(resolved_at) AS date, COUNT(*)::int AS incidents_resolved
       FROM incidents
       WHERE created_by = $1
         AND resolved_at IS NOT NULL
         AND resolved_at >= $2
         AND resolved_at < $3
       GROUP BY DATE(resolved_at)
     ),
     upserted AS (
       INSERT INTO agent_performance (
         agent_id, date, total_runs, successful_runs, failed_runs,
         total_cost, avg_duration_ms, avg_quality_score, max_quality_score, min_quality_score,
         total_tool_calls, decisions_filed, incidents_created, incidents_resolved
       )
       SELECT
         $1,
         r.date,
         r.total_runs,
         r.successful_runs,
         r.failed_runs,
         r.total_cost,
         r.avg_duration_ms,
         rf.avg_quality_score,
         rf.max_quality_score,
         rf.min_quality_score,
         r.total_tool_calls,
         COALESCE(dd.decisions_filed, 0),
         COALESCE(ic.incidents_created, 0),
         COALESCE(ir.incidents_resolved, 0)
       FROM daily_runs r
       LEFT JOIN daily_reflections rf ON rf.date = r.date
       LEFT JOIN daily_decisions dd ON dd.date = r.date
       LEFT JOIN daily_incidents_created ic ON ic.date = r.date
       LEFT JOIN daily_incidents_resolved ir ON ir.date = r.date
       ON CONFLICT (agent_id, date) DO UPDATE SET
         total_runs = EXCLUDED.total_runs,
         successful_runs = EXCLUDED.successful_runs,
         failed_runs = EXCLUDED.failed_runs,
         total_cost = EXCLUDED.total_cost,
         avg_duration_ms = EXCLUDED.avg_duration_ms,
         avg_quality_score = EXCLUDED.avg_quality_score,
         max_quality_score = EXCLUDED.max_quality_score,
         min_quality_score = EXCLUDED.min_quality_score,
         total_tool_calls = EXCLUDED.total_tool_calls,
         decisions_filed = EXCLUDED.decisions_filed,
         incidents_created = EXCLUDED.incidents_created,
         incidents_resolved = EXCLUDED.incidents_resolved
       RETURNING date
     )
     SELECT date::text FROM upserted`,
    [role, start.toISOString(), end.toISOString()],
  );

  return rows.length;
}

async function ensureMilestone(role: string): Promise<void> {
  const totals = await systemQuery<{ total_runs: number }>(
    'SELECT COALESCE(SUM(total_runs), 0)::int AS total_runs FROM agent_performance WHERE agent_id = $1',
    [role],
  );
  const totalRuns = totals[0]?.total_runs ?? 0;
  if (totalRuns < 100) return;

  const existing = await systemQuery<{ id: string }>(
    "SELECT id FROM agent_milestones WHERE agent_id = $1 AND title = '100 Runs Completed' LIMIT 1",
    [role],
  );
  if (existing.length) return;

  await systemQuery(
    'INSERT INTO agent_milestones (agent_id, type, title, description, created_at) VALUES ($1, $2, $3, $4, NOW())',
    [role, 'achievement', '100 Runs Completed', `Reached ${totalRuns} total runs`],
  );
}

async function countRows(table: 'agent_performance' | 'agent_milestones', role: string): Promise<number> {
  const column = table === 'agent_performance' ? 'agent_id' : 'agent_id';
  const rows = await systemQuery<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM ${table} WHERE ${column} = $1`,
    [role],
  );
  return rows[0]?.c ?? 0;
}

async function main(): Promise<void> {
  const role = getArg('--role', 'chief-of-staff');
  const days = Number(getArg('--days', '30'));

  const summary: Summary = {
    role,
    schedulesInserted: 0,
    perfRowsBefore: await countRows('agent_performance', role),
    perfRowsAfter: 0,
    milestonesBefore: await countRows('agent_milestones', role),
    milestonesAfter: 0,
    backfilledRows: 0,
  };

  summary.schedulesInserted = await ensureOpsSchedules();
  summary.backfilledRows = await backfillPerformance(role, Number.isFinite(days) ? days : 30);

  await systemQuery('SELECT * FROM compute_performance_scores()', []);
  await ensureMilestone(role);

  summary.perfRowsAfter = await countRows('agent_performance', role);
  summary.milestonesAfter = await countRows('agent_milestones', role);

  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[fix-agent-performance-pipeline] Failed: ${message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool().catch(() => undefined);
  });
