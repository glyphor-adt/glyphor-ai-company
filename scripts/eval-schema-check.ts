import { pool } from '@glyphor/shared/db';

async function main() {
  // List all tables
  const { rows: tables } = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
  );
  console.log('=== ALL TABLES ===');
  tables.forEach(r => console.log(r.table_name));

  // Check for agents-like tables
  console.log('\n=== AGENT-RELATED TABLES ===');
  const { rows: agentTables } = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE '%agent%' ORDER BY table_name"
  );
  agentTables.forEach(r => console.log(r.table_name));

  // Check for cron-like tables
  console.log('\n=== CRON/SCHEDULER TABLES ===');
  const { rows: cronTables } = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND (table_name LIKE '%cron%' OR table_name LIKE '%schedule%' OR table_name LIKE '%job%') ORDER BY table_name"
  );
  cronTables.forEach(r => console.log(r.table_name));

  // Check task_run_outcomes columns
  console.log('\n=== task_run_outcomes columns ===');
  const { rows: troCols } = await pool.query(
    "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'task_run_outcomes' ORDER BY ordinal_position"
  );
  troCols.forEach(r => console.log(`  ${r.column_name} (${r.data_type})`));

  // Check agent_runs table
  console.log('\n=== agent_runs sample ===');
  try {
    const { rows: runs } = await pool.query(
      "SELECT COUNT(*) AS total FROM agent_runs"
    );
    console.log(`agent_runs total: ${runs[0].total}`);
  } catch (e: any) {
    console.log(`agent_runs error: ${e.message}`);
  }

  // Check work_assignments - what do quality_score values look like
  console.log('\n=== work_assignments quality_score sample ===');
  const { rows: waRows } = await pool.query(
    "SELECT id, quality_score, status, updated_at FROM work_assignments ORDER BY updated_at DESC LIMIT 5"
  );
  waRows.forEach(r => console.log(`  id=${r.id}, quality_score=${r.quality_score}, status=${r.status}, updated=${r.updated_at}`));

  // Check assignment_evaluations row count
  console.log('\n=== assignment_evaluations ===');
  const { rows: aeRows } = await pool.query("SELECT COUNT(*) AS total FROM assignment_evaluations");
  console.log(`Total: ${aeRows[0].total}`);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
