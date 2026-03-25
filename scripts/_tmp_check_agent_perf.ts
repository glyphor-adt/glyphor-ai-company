import { closePool, systemQuery } from '@glyphor/shared/db';

async function main() {
  const role = process.argv[2] ?? 'chief-of-staff';
  const perf = await systemQuery<{ c: number }>('SELECT COUNT(*)::int AS c FROM agent_performance WHERE agent_id = $1', [role]);
  const growth = await systemQuery<{ c: number }>('SELECT COUNT(*)::int AS c FROM agent_growth WHERE agent_id = $1', [role]);
  const milestones = await systemQuery<{ c: number }>('SELECT COUNT(*)::int AS c FROM agent_milestones WHERE agent_id = $1', [role]);
  const reflections = await systemQuery<{ c: number }>('SELECT COUNT(*)::int AS c FROM agent_reflections WHERE agent_role = $1', [role]);

  const latestPerf = await systemQuery(
    'SELECT agent_id, date, total_runs, successful_runs, failed_runs, avg_quality_score FROM agent_performance WHERE agent_id = $1 ORDER BY date DESC LIMIT 5',
    [role],
  );

  console.log(JSON.stringify({
    role,
    counts: {
      agent_performance: perf[0]?.c ?? 0,
      agent_growth: growth[0]?.c ?? 0,
      agent_milestones: milestones[0]?.c ?? 0,
      agent_reflections: reflections[0]?.c ?? 0,
    },
    latestPerf,
  }, null, 2));
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool().catch(() => undefined);
  });
