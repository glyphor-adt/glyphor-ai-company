import { pool } from '@glyphor/shared/db';

async function main() {
  // Check what format assigned_to uses
  console.log('=== work_assignments.assigned_to sample ===');
  const { rows: wa } = await pool.query(
    "SELECT DISTINCT assigned_to FROM work_assignments WHERE assigned_to IS NOT NULL LIMIT 10"
  );
  wa.forEach(r => console.log(`  "${r.assigned_to}"`));

  // Check what format fleet_findings.agent_id uses
  console.log('\n=== fleet_findings.agent_id sample ===');
  const { rows: ff } = await pool.query(
    "SELECT DISTINCT agent_id FROM fleet_findings LIMIT 10"
  );
  ff.forEach(r => console.log(`  "${r.agent_id}"`));

  // Check agent_runs.agent_id format
  console.log('\n=== agent_runs.agent_id sample ===');
  const { rows: ar } = await pool.query(
    "SELECT DISTINCT agent_id FROM agent_runs LIMIT 10"
  );
  ar.forEach(r => console.log(`  "${r.agent_id}"`));

  // Check company_agents.role sample  
  console.log('\n=== company_agents role vs id ===');
  const { rows: ca } = await pool.query(
    "SELECT id, role, display_name FROM company_agents LIMIT 5"
  );
  ca.forEach(r => console.log(`  id="${r.id}", role="${r.role}", name="${r.display_name}"`));

  // Now test: what does the fleet query's eval_scores CTE return?
  console.log('\n=== eval_scores CTE (what assigned_to matches) ===');
  const { rows: es } = await pool.query(`
    SELECT wa.assigned_to AS agent_id, COUNT(*) AS eval_count
    FROM work_assignments wa
    JOIN assignment_evaluations ae ON ae.assignment_id = wa.id
    GROUP BY wa.assigned_to
    LIMIT 10
  `);
  if (es.length === 0) {
    console.log('  (empty — assignment_evaluations has 0 rows)');
  } else {
    es.forEach(r => console.log(`  "${r.agent_id}": ${r.eval_count} evals`));
  }

  // Check: does the performance score formula migration exist?
  console.log('\n=== schema_migrations listing ===');
  const { rows: migs } = await pool.query(
    "SELECT version, name FROM schema_migrations ORDER BY version DESC LIMIT 20"
  );
  migs.forEach(r => console.log(`  ${r.version}: ${r.name}`));

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
