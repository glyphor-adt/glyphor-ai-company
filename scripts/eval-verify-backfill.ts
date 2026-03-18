import { pool } from '@glyphor/shared/db';

async function main() {
  // task_run_outcomes coverage
  console.log('=== 1.1 Write path coverage ===');
  const { rows: [cov] } = await pool.query(`
    SELECT COUNT(*) AS total, COUNT(assignment_id) AS linked,
      ROUND(COUNT(assignment_id)::numeric / NULLIF(COUNT(*),0) * 100, 1) AS coverage_pct
    FROM task_run_outcomes
  `);
  console.log(`total=${cov.total}, linked=${cov.linked}, coverage=${cov.coverage_pct}%`);

  // Breakdown by final_status
  console.log('\n=== task_run_outcomes by status ===');
  const { rows: statusRows } = await pool.query(
    "SELECT final_status, COUNT(*) AS cnt, COUNT(assignment_id) AS with_assignment FROM task_run_outcomes GROUP BY final_status ORDER BY cnt DESC"
  );
  statusRows.forEach(r => console.log(`  ${r.final_status}: ${r.cnt} (${r.with_assignment} linked)`));

  // Per-run quality score distribution
  console.log('\n=== per_run_quality_score distribution ===');
  const { rows: scoreDist } = await pool.query(`
    SELECT
      CASE
        WHEN per_run_quality_score >= 3.5 THEN 'good (>=3.5)'
        WHEN per_run_quality_score >= 2.5 THEN 'ok (2.5-3.5)'
        WHEN per_run_quality_score >= 1.5 THEN 'low (1.5-2.5)'
        ELSE 'bad (<1.5)'
      END AS bucket,
      COUNT(*) AS cnt
    FROM task_run_outcomes
    WHERE per_run_quality_score IS NOT NULL
    GROUP BY 1 ORDER BY 1
  `);
  scoreDist.forEach(r => console.log(`  ${r.bucket}: ${r.cnt}`));

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
