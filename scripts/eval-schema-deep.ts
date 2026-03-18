import { pool } from '@glyphor/shared/db';

async function main() {
  // company_agents schema
  console.log('=== company_agents columns ===');
  const { rows: cols } = await pool.query(
    "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'company_agents' ORDER BY ordinal_position"
  );
  cols.forEach(r => console.log(`  ${r.column_name} (${r.data_type}, nullable=${r.is_nullable})`));

  // company_agents data sample
  console.log('\n=== company_agents sample ===');
  const { rows: agents } = await pool.query(
    "SELECT id, name, role, performance_score, updated_at FROM company_agents ORDER BY name LIMIT 30"
  );
  agents.forEach(r => console.log(`  ${r.name} (${r.role}): perf=${r.performance_score}, updated=${r.updated_at}`));
  console.log(`Total agents: ${agents.length}`);

  // Check agent_prompt_versions
  console.log('\n=== agent_prompt_versions coverage ===');
  const { rows: pvCoverage } = await pool.query(`
    SELECT
      ca.id, ca.name,
      COUNT(apv.id) AS version_count,
      MAX(apv.version) AS latest_version,
      MAX(CASE WHEN apv.deployed_at IS NOT NULL AND apv.retired_at IS NULL THEN 1 ELSE 0 END) AS has_active
    FROM company_agents ca
    LEFT JOIN agent_prompt_versions apv ON apv.agent_id = ca.id
    GROUP BY ca.id, ca.name
    ORDER BY ca.name
  `);
  const missing = pvCoverage.filter(r => r.has_active === 0 || r.version_count === 0);
  console.log(`Total: ${pvCoverage.length}, missing active version: ${missing.length}`);
  if (missing.length > 0) {
    missing.forEach(r => console.log(`  MISSING: ${r.name} (versions=${r.version_count}, has_active=${r.has_active})`));
  }

  // Performance score distribution
  console.log('\n=== Performance score distribution ===');
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
    GROUP BY 1
  `);
  dist.forEach(r => console.log(`  ${r.bucket}: ${r.agent_count}`));

  // Recent agent_runs with assignment linkage
  console.log('\n=== Recent agent_runs (last run per agent, top 10) ===');
  const { rows: recentRuns } = await pool.query(`
    SELECT ar.id, ar.agent_id, ar.status, ar.assignment_id, ar.created_at,
           ca.name AS agent_name
    FROM agent_runs ar
    LEFT JOIN company_agents ca ON ca.id = ar.agent_id
    ORDER BY ar.created_at DESC
    LIMIT 10
  `);
  recentRuns.forEach(r => console.log(`  ${r.agent_name || r.agent_id}: status=${r.status}, assignment_id=${r.assignment_id || 'NULL'}, created=${r.created_at}`));

  // task_run_outcomes — check if the table is truly empty or has rows without assignment_id
  console.log('\n=== task_run_outcomes quick check ===');
  const { rows: troCheck } = await pool.query("SELECT COUNT(*) AS total, COUNT(assignment_id) AS linked FROM task_run_outcomes");
  console.log(`total=${troCheck[0].total}, linked=${troCheck[0].linked}`);

  // Check if agent_runs has assignment_id column
  console.log('\n=== agent_runs columns ===');
  const { rows: arCols } = await pool.query(
    "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'agent_runs' ORDER BY ordinal_position"
  );
  arCols.forEach(r => console.log(`  ${r.column_name} (${r.data_type})`));

  // Check world_state for playbook 1.6 (with corrected SQL)
  console.log('\n=== world_state details ===');
  const { rows: ws } = await pool.query(`
    SELECT domain, COUNT(*) AS key_count, MAX(updated_at) AS last_write,
      COUNT(CASE WHEN valid_until < NOW() THEN 1 END) AS expired_count
    FROM world_state GROUP BY domain ORDER BY last_write DESC
  `);
  ws.forEach(r => console.log(`  ${r.domain}: ${r.key_count} keys, last_write=${r.last_write}, expired=${r.expired_count}`));

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
