const pg = require('pg');
const c = new pg.Client({
  host: '127.0.0.1',
  port: 6543,
  database: 'glyphor',
  user: 'glyphor_app',
  password: 'TempAuth2026x'
});

async function main() {
  await c.connect();

  // 1. Check what's in agent_disclosure_config and the FK constraint
  console.log('\n=== agent_disclosure_config schema ===');
  const schema = await c.query(
    `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'agent_disclosure_config' ORDER BY ordinal_position`
  );
  console.table(schema.rows);

  console.log('\n=== FK constraints on agent_disclosure_config ===');
  const fks = await c.query(
    `SELECT tc.constraint_name, kcu.column_name, ccu.table_name AS foreign_table, ccu.column_name AS foreign_column
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
     JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
     WHERE tc.table_name = 'agent_disclosure_config' AND tc.constraint_type = 'FOREIGN KEY'`
  );
  console.table(fks.rows);

  // 2. Check what agent_ids are in agent_disclosure_config vs company_agents
  console.log('\n=== agent_ids in agent_disclosure_config NOT in company_agents ===');
  const orphans = await c.query(
    `SELECT adc.agent_id FROM agent_disclosure_config adc
     LEFT JOIN company_agents ca ON adc.agent_id = ca.role
     WHERE ca.role IS NULL`
  );
  console.table(orphans.rows);

  console.log('\n=== All agent_ids in agent_disclosure_config ===');
  const allIds = await c.query(
    `SELECT DISTINCT agent_id FROM agent_disclosure_config ORDER BY agent_id`
  );
  console.table(allIds.rows);

  // 3. Check CFO agent_runs — look for the test prompt
  console.log('\n=== CFO recent runs (task + system prompt snippet) ===');
  const cfoRuns = await c.query(
    `SELECT id, task, status, created_at,
            LEFT(system_prompt, 300) as prompt_start
     FROM agent_runs
     WHERE agent_id = 'cfo'
     ORDER BY created_at DESC LIMIT 5`
  );
  for (const row of cfoRuns.rows) {
    console.log(`\n--- Run ${row.id} (${row.status}) @ ${row.created_at} ---`);
    console.log('Task:', row.task);
    console.log('Prompt start:', row.prompt_start);
  }

  // 4. Check if there's a standing directive or assignment driving the CFO test behavior
  console.log('\n=== CFO active assignments/directives ===');
  const directives = await c.query(
    `SELECT id, title, status, source, created_at
     FROM work_assignments
     WHERE agent_id = 'cfo' AND status NOT IN ('completed', 'cancelled')
     ORDER BY created_at DESC LIMIT 10`
  );
  console.table(directives.rows);

  await c.end();
}

main().catch(e => { console.error(e); c.end(); });
