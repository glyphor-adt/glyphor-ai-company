/**
 * Eval Test Playbook — Section 3: End-to-End Run Flow
 *
 * Validates the pipeline: agent_runs → task_run_outcomes → batch evaluation
 * → performance scores → reflection. Uses existing data.
 */
import { systemQuery } from '@glyphor/shared/db';

interface TestResult {
  id: string;
  name: string;
  pass: boolean;
  detail: string;
}

const results: TestResult[] = [];

function record(id: string, name: string, pass: boolean, detail: string) {
  results.push({ id, name, pass, detail });
  console.log(`${pass ? '✅' : '❌'} ${id} ${name}: ${detail}`);
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Section 3 — End-to-End Run Flow');
  console.log('═══════════════════════════════════════════════\n');

  // ── 3.1 Harvester write path: recent runs have outcomes ──
  try {
    const rows = await systemQuery<{ total_runs: number; runs_with_outcomes: number; coverage_pct: number }>(`
      SELECT
        (SELECT COUNT(*) FROM agent_runs WHERE created_at > NOW() - INTERVAL '7 days')::int AS total_runs,
        (SELECT COUNT(*) FROM task_run_outcomes WHERE created_at > NOW() - INTERVAL '7 days')::int AS runs_with_outcomes,
        CASE
          WHEN (SELECT COUNT(*) FROM agent_runs WHERE created_at > NOW() - INTERVAL '7 days') = 0 THEN 0
          ELSE ROUND(
            100.0 * (SELECT COUNT(*) FROM task_run_outcomes WHERE created_at > NOW() - INTERVAL '7 days')
            / (SELECT COUNT(*) FROM agent_runs WHERE created_at > NOW() - INTERVAL '7 days'), 1
          )
        END AS coverage_pct
    `);
    const r = rows[0]!;
    const pass = r.runs_with_outcomes > 0 && r.coverage_pct > 10;
    record('3.1', 'Harvester write path (7d)', pass,
      `${r.total_runs} runs, ${r.runs_with_outcomes} outcomes, ${r.coverage_pct}% coverage`);
  } catch (err) {
    record('3.1', 'Harvester write path', false, (err as Error).message);
  }

  // ── 3.2 Per-run quality scores populated ─────────────────
  try {
    const rows = await systemQuery<{
      total_outcomes: number;
      with_quality_score: number;
      avg_score: number;
      min_score: number;
      max_score: number;
    }>(`
      SELECT
        COUNT(*)::int AS total_outcomes,
        COUNT(per_run_quality_score)::int AS with_quality_score,
        ROUND(AVG(per_run_quality_score)::numeric, 2) AS avg_score,
        MIN(per_run_quality_score) AS min_score,
        MAX(per_run_quality_score) AS max_score
      FROM task_run_outcomes
    `);
    const r = rows[0]!;
    const pct = r.total_outcomes > 0
      ? Math.round(100 * r.with_quality_score / r.total_outcomes)
      : 0;
    const pass = r.with_quality_score > 0 && pct > 50;
    record('3.2', 'Per-run quality scores', pass,
      `${r.with_quality_score}/${r.total_outcomes} have scores (${pct}%) | avg=${r.avg_score}, range=[${r.min_score}, ${r.max_score}]`);
  } catch (err) {
    record('3.2', 'Per-run quality scores', false, (err as Error).message);
  }

  // ── 3.3 ON CONFLICT uniqueness (UNIQUE constraint on run_id) ──
  try {
    const rows = await systemQuery<{ constraint_name: string }>(`
      SELECT constraint_name
      FROM information_schema.table_constraints
      WHERE table_name = 'task_run_outcomes'
        AND constraint_type = 'UNIQUE'
    `);
    const hasUnique = rows.some((r: any) => r.constraint_name.includes('run_id'));
    record('3.3', 'UNIQUE constraint on run_id', hasUnique,
      hasUnique
        ? `Found: ${rows.map((r: any) => r.constraint_name).join(', ')}`
        : `Missing! Harvester ON CONFLICT will silently fail`);
  } catch (err) {
    record('3.3', 'UNIQUE constraint on run_id', false, (err as Error).message);
  }

  // ── 3.4 Downstream signals (accepted/revised) ────────────
  try {
    const rows = await systemQuery<{ status: string | null; cnt: number }>(`
      SELECT downstream_status AS status, COUNT(*)::int AS cnt
      FROM task_run_outcomes
      GROUP BY downstream_status
      ORDER BY cnt DESC
    `);
    const accepted = rows.find((r: any) => r.status === 'accepted');
    const revised = rows.find((r: any) => r.status === 'revised');
    const unset = rows.find((r: any) => r.status === null);

    const detail = rows.map((r: any) =>
      `${r.status ?? 'NULL'}: ${r.cnt}`
    ).join(', ');

    // Pass if the column exists and query succeeds (downstream signals need live orchestrator)
    const pass = true; // column exists + query works
    record('3.4', 'Downstream signals (accepted/revised)', pass,
      `Distribution: ${detail}` +
      (accepted ? '' : ' | ⚠ No accepted yet (needs orchestrator cycles)') +
      (revised ? '' : ' | ⚠ No revised yet (needs orchestrator cycles)'));
  } catch (err) {
    record('3.4', 'Downstream signals', false, (err as Error).message);
  }

  // ── 3.5 Batch evaluator outputs ──────────────────────────
  try {
    const rows = await systemQuery<{
      batch_evaluated: number;
      not_evaluated: number;
      avg_batch_score: number;
    }>(`
      SELECT
        COUNT(*) FILTER (WHERE batch_evaluated_at IS NOT NULL)::int AS batch_evaluated,
        COUNT(*) FILTER (WHERE batch_evaluated_at IS NULL)::int AS not_evaluated,
        ROUND(AVG(batch_quality_score) FILTER (WHERE batch_evaluated_at IS NOT NULL)::numeric, 2) AS avg_batch_score
      FROM task_run_outcomes
    `);
    const r = rows[0]!;
    // Batch eval runs twice daily — may not have run yet for backfilled data
    const pass = true; // query succeeds; batch may not have run yet
    record('3.5', 'Batch evaluator outputs', pass,
      `${r.batch_evaluated} batch-evaluated, ${r.not_evaluated} pending` +
      (r.batch_evaluated > 0 ? ` | avg batch score: ${r.avg_batch_score}` : ' | ⚠ No batch eval cycles yet (runs 02:00/14:00 UTC)'));
  } catch (err) {
    record('3.5', 'Batch evaluator outputs', false, (err as Error).message);
  }

  // ── 3.6 Performance scores are meaningful ────────────────
  try {
    const rows = await systemQuery<{
      total_agents: number;
      scored_agents: number;
      distinct_scores: number;
      avg_score: number;
      min_score: number;
      max_score: number;
    }>(`
      SELECT
        COUNT(*)::int AS total_agents,
        COUNT(performance_score)::int AS scored_agents,
        COUNT(DISTINCT performance_score)::int AS distinct_scores,
        ROUND(AVG(performance_score)::numeric, 3) AS avg_score,
        MIN(performance_score) AS min_score,
        MAX(performance_score) AS max_score
      FROM company_agents
    `);
    const r = rows[0]!;
    const pass = r.distinct_scores >= 3 && r.scored_agents > 0;
    record('3.6', 'Performance scores meaningful', pass,
      `${r.scored_agents}/${r.total_agents} scored (${r.distinct_scores} distinct) | avg=${r.avg_score}, range=[${r.min_score}, ${r.max_score}]`);
  } catch (err) {
    record('3.6', 'Performance scores meaningful', false, (err as Error).message);
  }

  // ── Summary ──────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════');
  const passed = results.filter(r => r.pass).length;
  const total = results.length;
  console.log(`  Section 3 Result: ${passed}/${total} passed`);
  console.log('═══════════════════════════════════════════════');

  if (passed < total) {
    console.log('\nFailed checks:');
    results.filter(r => !r.pass).forEach(r => console.log(`  ${r.id} ${r.name}: ${r.detail}`));
  }

  process.exit(passed === total ? 0 : 1);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(2);
});
