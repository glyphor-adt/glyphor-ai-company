import { pool } from '@glyphor/shared/db';

async function main() {
  // agent_prompt_versions schema
  console.log('=== agent_prompt_versions columns ===');
  const { rows: cols } = await pool.query(
    "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'agent_prompt_versions' ORDER BY ordinal_position"
  );
  cols.forEach(r => console.log(`  ${r.column_name} (${r.data_type})`));

  // Sample agent_prompt_versions
  console.log('\n=== agent_prompt_versions sample ===');
  const { rows: pvSample } = await pool.query(
    "SELECT id, agent_id, version, source, deployed_at, retired_at, created_at FROM agent_prompt_versions ORDER BY created_at DESC LIMIT 10"
  );
  pvSample.forEach(r => console.log(`  agent_id=${r.agent_id}, v${r.version}, source=${r.source}, deployed=${r.deployed_at}, retired=${r.retired_at}`));

  // Count prompt versions grouped by agent_id with text cast
  console.log('\n=== Prompt version coverage (with text cast) ===');
  const { rows: pvCoverage } = await pool.query(`
    SELECT
      ca.id, ca.name,
      COUNT(apv.id) AS version_count,
      MAX(apv.version) AS latest_version,
      MAX(CASE WHEN apv.deployed_at IS NOT NULL AND apv.retired_at IS NULL THEN 1 ELSE 0 END) AS has_active
    FROM company_agents ca
    LEFT JOIN agent_prompt_versions apv ON apv.agent_id = ca.id::text
    GROUP BY ca.id, ca.name
    HAVING MAX(CASE WHEN apv.deployed_at IS NOT NULL AND apv.retired_at IS NULL THEN 1 ELSE 0 END) = 0
       OR COUNT(apv.id) = 0
    ORDER BY ca.name
  `);
  console.log(`Agents missing active prompt: ${pvCoverage.length}`);
  pvCoverage.forEach(r => console.log(`  ${r.name}: versions=${r.version_count}, has_active=${r.has_active}`));

  // Check what agent_id values look like in agent_prompt_versions vs company_agents
  console.log('\n=== agent_prompt_versions agent_id format ===');
  const { rows: pvIds } = await pool.query("SELECT DISTINCT agent_id FROM agent_prompt_versions LIMIT 5");
  pvIds.forEach(r => console.log(`  apv.agent_id = "${r.agent_id}"`));

  console.log('\n=== company_agents id format ===');
  const { rows: caIds } = await pool.query("SELECT id FROM company_agents LIMIT 5");
  caIds.forEach(r => console.log(`  ca.id = "${r.id}"`));

  // Check baseAgentRunner outcome write path: look at agent_runs recent outcomes
  console.log('\n=== agent_runs recent completions ===');
  const { rows: completions } = await pool.query(`
    SELECT id, agent_id, status, assignment_id, directive_id, created_at, updated_at
    FROM agent_runs
    WHERE status IN ('completed', 'failed')
    ORDER BY updated_at DESC
    LIMIT 5
  `);
  completions.forEach(r => console.log(`  run=${r.id}, agent=${r.agent_id}, status=${r.status}, assignment=${r.assignment_id || 'NULL'}, directive=${r.directive_id || 'NULL'}`));

  // Does agent_runs have the newer columns?
  console.log('\n=== agent_runs has assignment_id? ===');
  const { rows: arCols } = await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'agent_runs' AND column_name IN ('assignment_id', 'directive_id', 'input_tokens', 'output_tokens', 'thinking_tokens')"
  );
  arCols.forEach(r => console.log(`  ${r.column_name}: YES`));

  // Check eval API references
  console.log('\n=== constitutional_evaluations sample ===');
  const { rows: ce } = await pool.query("SELECT COUNT(*) AS total FROM constitutional_evaluations");
  console.log(`Total: ${ce[0].total}`);

  // Check agent_eval_results
  console.log('\n=== agent_eval_results sample ===');
  const { rows: aer } = await pool.query("SELECT COUNT(*) AS total FROM agent_eval_results");
  console.log(`Total: ${aer[0].total}`);

  // agent_eval_results recent
  const { rows: aerRecent } = await pool.query("SELECT * FROM agent_eval_results ORDER BY created_at DESC LIMIT 3");
  aerRecent.forEach(r => console.log(`  `, JSON.stringify(r).slice(0, 200)));

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
