import { createDbPool } from './lib/migrationLedger.js';

(async () => {
  const pool = createDbPool();
  const query = async <T extends Record<string, unknown>>(sql: string): Promise<T[]> => {
    const result = await pool.query(sql);
    return result.rows as T[];
  };
  // 1. Coverage baseline
  const [cov] = await query<{
    total_outcomes: number; with_assignment: number; coverage_pct: number;
    oldest: string; newest: string;
  }>('SELECT COUNT(*) AS total_outcomes, COUNT(assignment_id) AS with_assignment, ROUND(COUNT(assignment_id)::numeric / NULLIF(COUNT(*), 0) * 100, 1) AS coverage_pct, MIN(created_at) AS oldest, MAX(created_at) AS newest FROM task_run_outcomes');
  console.log('\n=== 1. Linkage Coverage ===');
  console.table([cov]);

  // 2. assignment_evaluations (should be empty pre-deploy)
  const aeRows = await query<{ evaluator_type: string; cnt: number; avg_norm: number }>(
    "SELECT evaluator_type, COUNT(*)::int AS cnt, ROUND(AVG(score_normalized)::numeric, 3) AS avg_norm FROM assignment_evaluations GROUP BY evaluator_type"
  );
  console.log('\n=== 2. assignment_evaluations ===');
  if (aeRows.length) console.table(aeRows);
  else console.log('  (empty — expected before evaluators run)');

  // 3. fleet_findings table exists
  const [ff] = await query<{ cnt: number }>('SELECT COUNT(*)::int AS cnt FROM fleet_findings');
  console.log('\n=== 3. fleet_findings ===');
  console.table([ff]);

  // 4. marketing eval scenarios seeded
  const scenarios = await query<{ agent_role: string; cnt: number }>(
    "SELECT agent_role, COUNT(*)::int AS cnt FROM agent_eval_scenarios WHERE agent_role IN ('content-creator','seo-analyst','social-media-manager') GROUP BY agent_role ORDER BY agent_role"
  );
  console.log('\n=== 4. Marketing Eval Scenarios ===');
  console.table(scenarios);

  // 5. NULL perf scores for agents with completed work
  const [nullScores] = await query<{ cnt: number }>(
    "SELECT COUNT(*)::int AS cnt FROM company_agents WHERE performance_score IS NULL AND role IN (SELECT DISTINCT assigned_to FROM work_assignments WHERE status = 'completed')"
  );
  console.log('\n=== 5. Agents with NULL score + completed assignments ===');
  console.table([nullScores]);

  // 6. Score distribution
  const dist = await query<{ bucket: number; agent_count: number }>(
    "SELECT ROUND(performance_score * 10) / 10 AS bucket, COUNT(*)::int AS agent_count FROM company_agents WHERE performance_score IS NOT NULL GROUP BY bucket ORDER BY bucket"
  );
  console.log('\n=== 6. Score Distribution ===');
  if (dist.length) console.table(dist);
  else console.log('  (no scores yet — run compute_performance_scores() after evaluators produce data)');

  // 7. Recompute performance scores with new formula
  console.log('\n=== 7. Recompute performance_scores (new v2 formula) ===');
  const updated = await query<{ agent_role: string; new_score: number }>(
    'SELECT * FROM compute_performance_scores()'
  );
  console.table(updated.slice(0, 15));
  console.log(`  (${updated.length} agents updated)`);

  await pool.end();
})();
