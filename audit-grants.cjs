require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function audit() {
  // Get all active agents
  const agents = await pool.query(
    "SELECT role, display_name, status FROM company_agents WHERE status = 'active' ORDER BY role"
  );

  // Get grant counts per role
  const grants = await pool.query(
    "SELECT agent_role, COUNT(*) as cnt FROM agent_tool_grants WHERE is_active = true GROUP BY agent_role ORDER BY agent_role"
  );
  const grantMap = new Map(grants.rows.map(r => [r.agent_role, parseInt(r.cnt)]));

  console.log('=== AGENT TOOL GRANT AUDIT ===\n');
  console.log(`Active agents: ${agents.rows.length}`);
  console.log(`Agents with grants: ${grants.rows.length}\n`);

  const missing = [];
  const low = [];

  for (const agent of agents.rows) {
    const count = grantMap.get(agent.role) || 0;
    const label = `${agent.role} (${agent.display_name || 'no name'})`;
    if (count === 0) {
      missing.push(label);
      console.log(`  ❌ ${label} — NO GRANTS`);
    } else if (count < 5) {
      low.push({ label, count });
      console.log(`  ⚠️  ${label} — only ${count} grants`);
    } else {
      console.log(`  ✅ ${label} — ${count} grants`);
    }
  }

  // Check for grants that reference non-existent agent roles
  const agentRoles = new Set(agents.rows.map(r => r.role));
  const orphanGrants = grants.rows.filter(r => !agentRoles.has(r.agent_role));

  if (missing.length > 0) {
    console.log(`\n🚨 MISSING GRANTS (${missing.length}):`);
    missing.forEach(m => console.log(`  - ${m}`));
  }
  if (low.length > 0) {
    console.log(`\n⚠️  LOW GRANTS (${low.length}):`);
    low.forEach(l => console.log(`  - ${l.label}: ${l.count} grants`));
  }
  if (orphanGrants.length > 0) {
    console.log(`\n👻 ORPHAN GRANTS (role not in company_agents):`);
    orphanGrants.forEach(o => console.log(`  - ${o.agent_role}: ${o.cnt} grants`));
  }
  if (missing.length === 0 && low.length === 0) {
    console.log('\n✅ All active agents have tool grants.');
  }

  pool.end();
}

audit().catch(e => { console.error('ERROR:', e.message); pool.end(); });
