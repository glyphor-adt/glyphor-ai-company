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

  // 1. Get the contaminated CFO run's prompt_components and full output reasoning
  console.log('\n=== CFO contaminated run prompt_components ===');
  const pc = await c.query(
    `SELECT id, prompt_components, LEFT(output, 3000) as output_text, source
     FROM agent_runs
     WHERE id = '5535a0a4-6c6f-4967-bbec-c420283aafb1'`
  );
  for (const row of pc.rows) {
    console.log('Source:', row.source);
    console.log('Prompt components:', JSON.stringify(row.prompt_components, null, 2));
    console.log('\nOutput:\n', row.output_text);
  }

  // 2. Check eval_scenarios for CFO
  console.log('\n=== agent_eval_scenarios for CFO ===');
  const evalCols = await c.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'agent_eval_scenarios' ORDER BY ordinal_position`
  );
  console.log('Columns:', evalCols.rows.map(r => r.column_name).join(', '));

  const evals = await c.query(
    `SELECT * FROM agent_eval_scenarios WHERE agent_id = 'cfo' ORDER BY created_at DESC LIMIT 5`
  );
  for (const row of evals.rows) {
    console.log('\n--- Eval scenario ---');
    for (const [k, v] of Object.entries(row)) {
      const val = typeof v === 'string' ? v.substring(0, 300) : v;
      console.log(`  ${k}:`, val);
    }
  }

  // 3. Check all CFO runs today that had "acceptance" in output reasoning
  console.log('\n=== All CFO runs with fake blocking behavior ===');
  const faked = await c.query(
    `SELECT id, task, created_at, status, source, LEFT(output, 800) as output_start
     FROM agent_runs
     WHERE agent_id = 'cfo'
       AND (output ILIKE '%acceptance_criteria%' OR output ILIKE '%negative_constraint%'
         OR output ILIKE '%I am fulfilling%' OR output ILIKE '%simulated block%')
     ORDER BY created_at DESC LIMIT 5`
  );
  for (const row of faked.rows) {
    console.log(`\n--- ${row.id} (${row.status}) @ ${row.created_at} ---`);
    console.log('Task:', row.task, '| Source:', row.source);
    console.log('Output:', row.output_start);
  }

  // 4. Look at the weekly_review tool_calls to see what it tried to insert
  console.log('\n=== weekly_review failed run tool_calls ===');
  const wrTools = await c.query(
    `SELECT id, tool_calls, LEFT(input, 2000) as input_start
     FROM agent_runs
     WHERE agent_id = 'chief-of-staff' AND task = 'weekly_review' AND status = 'failed'
     ORDER BY created_at DESC LIMIT 1`
  );
  for (const row of wrTools.rows) {
    const tc = row.tool_calls;
    if (tc) {
      const parsed = typeof tc === 'string' ? JSON.parse(tc) : tc;
      console.log('Tool calls:', JSON.stringify(parsed, null, 2)?.substring(0, 3000));
    }
    console.log('\nInput start:', row.input_start);
  }

  await c.end();
}

main().catch(e => { console.error(e); c.end(); });
