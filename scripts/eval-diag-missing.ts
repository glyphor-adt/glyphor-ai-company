import { pool } from '@glyphor/shared/db';

async function main() {
  // Check agent_schedules columns
  console.log('=== agent_schedules columns ===');
  const { rows: cols } = await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'agent_schedules' ORDER BY ordinal_position"
  );
  cols.forEach(r => console.log(`  ${r.column_name}`));

  // Check what agent roles are in agent_prompt_versions
  console.log('\n=== agent_prompt_versions distinct agent_ids ===');
  const { rows: pvIds } = await pool.query("SELECT DISTINCT agent_id FROM agent_prompt_versions ORDER BY agent_id");
  pvIds.forEach(r => console.log(`  ${r.agent_id}`));

  // Check the 5 missing agents  
  console.log('\n=== Missing agent roles ===');
  const { rows: missing } = await pool.query(`
    SELECT name, role FROM company_agents 
    WHERE name IN ('Mia Chen', 'Specialist UI-UX Auditor', 'Morgan Blake', 'Ethan', 'Tooling Test Specialist')
  `);
  missing.forEach(r => console.log(`  ${r.name}: role="${r.role}"`));

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
