const { Client } = require('pg');
const c = new Client({
  connectionString: 'postgresql://glyphor_system_user:a7JwuQFobpCzZI+JWyPhCSheZFvIt2OA0rjt9FJvtJ4CaagtOM9p72mdTCM5IHzN@127.0.0.1:6543/glyphor'
});

async function main() {
  await c.connect();
  
  const r = await c.query(`
    SELECT event_object_table, trigger_name, action_statement 
    FROM information_schema.triggers 
    WHERE event_object_table IN (
      'agent_runs','agent_trust_scores','kg_contradictions','agent_handoff_contracts',
      'agent_run_events','agent_eval_results','task_run_outcomes','agent_autonomy_config',
      'autonomy_level_config','autonomy_level_thresholds','autonomy_level_history'
    )
    ORDER BY event_object_table
  `);
  
  if (r.rows.length === 0) {
    console.log('No triggers found');
  } else {
    r.rows.forEach(t => console.log(`${t.event_object_table}: ${t.trigger_name} -> ${t.action_statement}`));
  }

  // Also check for any custom functions used in queries  
  console.log('\n=== Check kg_contradictions column types ===');
  const cols = await c.query(`
    SELECT column_name, data_type, udt_name 
    FROM information_schema.columns 
    WHERE table_name = 'kg_contradictions'
    ORDER BY ordinal_position
  `);
  cols.rows.forEach(r => console.log(`  ${r.column_name}: ${r.data_type} (${r.udt_name})`));
  
  await c.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
