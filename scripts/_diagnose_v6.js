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

  // 1. CFO eval scenarios (correct column: agent_role)
  console.log('\n=== agent_eval_scenarios for CFO ===');
  const evals = await c.query(
    `SELECT id, scenario_name, LEFT(input_prompt, 300) as prompt, LEFT(pass_criteria, 300) as pass, LEFT(fail_indicators, 300) as fail_ind
     FROM agent_eval_scenarios WHERE agent_role = 'cfo' ORDER BY created_at DESC LIMIT 10`
  );
  for (const row of evals.rows) {
    console.log(`\n--- ${row.scenario_name} (${row.id}) ---`);
    console.log('Prompt:', row.prompt);
    console.log('Pass:', row.pass);
    console.log('Fail:', row.fail_ind);
  }

  // 2. Check if eval scenarios are injected into agent_runs input/prompt via cert test 
  console.log('\n=== Recent CFO runs with source = cert or eval ===');
  const certRuns = await c.query(
    `SELECT id, task, source, created_at, status
     FROM agent_runs
     WHERE agent_id = 'cfo' AND (source ILIKE '%cert%' OR source ILIKE '%eval%' OR source ILIKE '%test%')
     ORDER BY created_at DESC LIMIT 10`
  );
  console.table(certRuns.rows);

  // 3. What's the full reasoning of a recent contaminated run?
  console.log('\n=== Recent CFO runs output search for "acceptance" ===');
  const acceptance = await c.query(
    `SELECT id, created_at, task, source, status
     FROM agent_runs
     WHERE agent_id = 'cfo' AND output ILIKE '%acceptance%'
     ORDER BY created_at DESC LIMIT 10`
  );
  console.table(acceptance.rows);

  // 4. Check if all those runs have source = 'cert_test' or 'internal'
  if (acceptance.rows.length > 0) {
    const ids = acceptance.rows.map(r => r.id);
    console.log('\n=== Sources for contaminated runs ===');
    const sources = await c.query(
      `SELECT id, source, task, created_at FROM agent_runs WHERE id = ANY($1::uuid[])`,
      [ids]
    );
    console.table(sources.rows);
  }

  // 5. Check the weekly_review input to understand what it was trying to do with disclosure_config
  console.log('\n=== weekly_review input (first 3000 chars) ===');
  const wrInput = await c.query(
    `SELECT LEFT(input, 3000) as input_text
     FROM agent_runs
     WHERE agent_id = 'chief-of-staff' AND task = 'weekly_review' AND status = 'failed'
     ORDER BY created_at DESC LIMIT 1`
  );
  for (const row of wrInput.rows) {
    console.log(row.input_text);
  }

  // 6. What roles exist in the roster but not in company_agents? (Could cause FK)
  console.log('\n=== All company_agents roles ===');
  const allRoles = await c.query(`SELECT role, status FROM company_agents ORDER BY role`);
  console.table(allRoles.rows);

  await c.end();
}

main().catch(e => { console.error(e); c.end(); });
