import { pool } from '@glyphor/shared/db';

async function main() {
  // Check task_run_outcomes schema vs what harvester expects
  console.log('=== task_run_outcomes full schema ===');
  const { rows: troCols } = await pool.query(
    "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'task_run_outcomes' ORDER BY ordinal_position"
  );
  troCols.forEach(r => console.log(`  ${r.column_name} (${r.data_type}, nullable=${r.is_nullable}, default=${r.column_default || 'none'})`));

  // Check if there's a unique constraint on run_id (for ON CONFLICT)
  console.log('\n=== task_run_outcomes constraints ===');
  const { rows: constraints } = await pool.query(`
    SELECT tc.constraint_name, tc.constraint_type, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
    WHERE tc.table_name = 'task_run_outcomes'
    ORDER BY tc.constraint_type, tc.constraint_name
  `);
  constraints.forEach(r => console.log(`  ${r.constraint_type}: ${r.constraint_name} (${r.column_name})`));

  // Check if there's a downstream_status column (used by markOutcomeRevised)
  console.log('\n=== Has downstream_status? ===');
  const { rows: dsCols } = await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'task_run_outcomes' AND column_name = 'downstream_status'"
  );
  console.log(dsCols.length > 0 ? 'YES' : 'NO');

  // Try a test INSERT and see what happens
  console.log('\n=== Test INSERT (dry-run via EXPLAIN) ===');
  try {
    const { rows: explain } = await pool.query(`
      EXPLAIN INSERT INTO task_run_outcomes (
        run_id, agent_role, directive_id, assignment_id,
        final_status, turn_count, tool_call_count, tool_failure_count,
        had_partial_save, elapsed_ms, cost_usd, input_tokens, output_tokens,
        per_run_quality_score, per_run_evaluation_notes
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      ON CONFLICT (run_id) DO NOTHING
    `, [
      '00000000-0000-0000-0000-000000000000', 'test-role', null, null,
      'submitted', 0, 0, 0, false, 0, 0, 0, 0, 3.0, 'test'
    ]);
    console.log('EXPLAIN OK - INSERT should work');
  } catch (e: any) {
    console.log(`EXPLAIN ERROR: ${e.message}`);
  }

  // Check agent_runs to see if there are any runs that SHOULD have produced outcomes
  console.log('\n=== Recent agent_runs (examining status) ===');
  const { rows: runs } = await pool.query(`
    SELECT status, COUNT(*) AS cnt FROM agent_runs GROUP BY status ORDER BY cnt DESC
  `);
  runs.forEach(r => console.log(`  ${r.status}: ${r.cnt}`));

  // Look at column list on agent_runs
  console.log('\n=== agent_runs full columns ===');
  const { rows: arCols } = await pool.query(
    "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'agent_runs' ORDER BY ordinal_position"
  );
  arCols.forEach(r => console.log(`  ${r.column_name} (${r.data_type})`));

  // Check the most recent runs created_at
  console.log('\n=== Latest agent_runs ===');
  const { rows: latest } = await pool.query(
    "SELECT id, agent_id, status, created_at FROM agent_runs ORDER BY created_at DESC LIMIT 5"
  );
  latest.forEach(r => console.log(`  ${r.id} agent=${r.agent_id} status=${r.status} at=${r.created_at}`));

  // Check if the deployed code has the harvester call — look at the worker build timestamp
  console.log('\n=== Checking if runs since harvester deployment exist ===');
  // Migration 20260317140000 added per_run_quality_score — any runs after that should have outcomes
  const { rows: postMigRuns } = await pool.query(`
    SELECT COUNT(*) AS cnt FROM agent_runs WHERE created_at > '2026-03-17 14:00:00Z'
  `);
  console.log(`Runs after 2026-03-17 14:00 UTC: ${postMigRuns[0].cnt}`);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
