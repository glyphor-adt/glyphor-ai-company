import { pool } from '@glyphor/shared/db';

async function main() {
  // Run the performance score formula
  console.log('=== Running compute_performance_scores() ===');
  try {
    const { rows } = await pool.query('SELECT * FROM compute_performance_scores()');
    console.log(`Updated ${rows.length} agents:`);
    rows.forEach(r => console.log(`  ${r.agent_role}: ${r.new_score}`));
  } catch (err: any) {
    console.error('ERROR running compute_performance_scores():', err.message);
    if (err.hint) console.error('Hint:', err.hint);
  }

  // Verify new distribution
  console.log('\n=== New performance score distribution ===');
  const { rows: dist } = await pool.query(`
    SELECT
      CASE
        WHEN performance_score >= 0.75 THEN 'healthy'
        WHEN performance_score >= 0.50 THEN 'degraded'
        WHEN performance_score IS NULL  THEN 'unscored'
        ELSE 'unhealthy'
      END AS bucket,
      COUNT(*) AS agent_count
    FROM company_agents
    GROUP BY 1 ORDER BY 1
  `);
  dist.forEach(r => console.log(`  ${r.bucket}: ${r.agent_count}`));

  // List unique scores
  console.log('\n=== Distinct scores ===');
  const { rows: scores } = await pool.query(
    "SELECT DISTINCT performance_score FROM company_agents ORDER BY performance_score"
  );
  scores.forEach(r => console.log(`  ${r.performance_score}`));

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
