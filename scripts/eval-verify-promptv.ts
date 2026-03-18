import { pool } from '@glyphor/shared/db';

async function main() {
  // Check prompt version coverage after backfill
  const { rows } = await pool.query(`
    SELECT ca.name, ca.role, COUNT(apv.id) AS versions
    FROM company_agents ca
    LEFT JOIN agent_prompt_versions apv ON apv.agent_id = ca.role
    GROUP BY ca.name, ca.role
    HAVING COUNT(apv.id) = 0
    ORDER BY ca.name
  `);
  
  if (rows.length === 0) {
    console.log('✅ All agents have prompt versions');
  } else {
    console.log(`❌ ${rows.length} agents still missing:`);
    rows.forEach(r => console.log(`  ${r.name} (${r.role})`));
  }

  // Count total prompt versions
  const { rows: [total] } = await pool.query("SELECT COUNT(*) AS cnt FROM agent_prompt_versions");
  console.log(`\nTotal prompt versions: ${total.cnt}`);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
