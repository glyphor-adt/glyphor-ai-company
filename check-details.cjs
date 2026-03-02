require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function check() {
  // Check morgan-blake orphan grants
  const mb = await pool.query("SELECT tool_name FROM agent_tool_grants WHERE agent_role = 'morgan-blake'");
  console.log('morgan-blake grants:', mb.rows.map(r => r.tool_name));

  // Check adi-rose grants
  const ar = await pool.query("SELECT tool_name FROM agent_tool_grants WHERE agent_role = 'adi-rose'");
  console.log('adi-rose grants:', ar.rows.map(r => r.tool_name));

  // Check db-only agents in company_agents
  const dbOnly = ['bob-the-tax-pro','data-integrity-auditor','elena-vance','enterprise-account-researcher','lead-gen-specialist','marketing-intelligence-analyst','tax-strategy-specialist','adi-rose'];
  const res = await pool.query("SELECT role, display_name, status, reports_to, team FROM company_agents WHERE role = ANY($1)", [dbOnly]);
  console.log('\nDB-only agents:');
  res.rows.forEach(r => console.log(`  ${r.role}: ${r.display_name} (${r.status}) reports_to=${r.reports_to} team=${r.team}`));

  pool.end();
}
check().catch(e => { console.error(e.message); pool.end(); });
