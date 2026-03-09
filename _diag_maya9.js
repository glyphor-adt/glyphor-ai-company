const { Client } = require('pg');
const c = new Client({ host:'127.0.0.1', port:5434, user:'glyphor_app', password:'lGHMxoC8zpmngKUaYv9cOTwJ', database:'glyphor' });

(async()=>{
  await c.connect();

  // CMO tool grants
  console.log('=== CMO TOOL GRANTS ===');
  const tg = await c.query(`SELECT * FROM agent_tool_grants WHERE agent_role = 'cmo' AND is_active = true ORDER BY created_at DESC`);
  for (const r of tg.rows) {
    console.log(`${r.tool_name} | scope=${r.scope} | blocked=${r.is_blocked} | by=${r.granted_by} | ${r.created_at}`);
  }

  // CMO vs COS tool grants count
  console.log('\n=== TOOL GRANT COUNTS ===');
  const tgc = await c.query(`
    SELECT agent_role, COUNT(*) as cnt, SUM(CASE WHEN is_blocked THEN 1 ELSE 0 END) as blocked
    FROM agent_tool_grants 
    WHERE agent_role IN ('cmo','chief-of-staff') AND is_active = true
    GROUP BY agent_role
  `);
  for (const r of tgc.rows) console.log(`${r.agent_role}: ${r.cnt} tools (${r.blocked} blocked)`);

  // Check specific CMO tool grants for pulse-related tools
  console.log('\n=== PULSE TOOLS ===');
  const pulse = await c.query(`SELECT * FROM agent_tool_grants WHERE tool_name LIKE '%pulse%' OR tool_name LIKE '%Pulse%'`);
  for (const r of pulse.rows) {
    console.log(`${r.agent_role} | ${r.tool_name} | active=${r.is_active} | blocked=${r.is_blocked}`);
  }

  // Check runtime_tools for pulse
  console.log('\n=== RUNTIME TOOLS (pulse) ===');
  const rt = await c.query(`SELECT name, description, is_active, LEFT(parameters::text, 200) as params FROM runtime_tools WHERE name LIKE '%pulse%' OR name LIKE '%Pulse%' OR description LIKE '%pulse%' OR description LIKE '%Pulse%'`);
  for (const r of rt.rows) console.log(`${r.name} | active=${r.is_active} | ${r.description} | params=${r.params}`);

  // Check tool_registry for pulse
  console.log('\n=== TOOL REGISTRY (pulse) ===');
  const treg = await c.query(`SELECT name, description, is_active, category FROM tool_registry WHERE name LIKE '%pulse%' OR name LIKE '%Pulse%' OR description LIKE '%pulse%' OR description LIKE '%Pulse%'`);
  for (const r of treg.rows) console.log(`${r.name} | active=${r.is_active} | ${r.category} | ${r.description}`);

  // Check agent_briefs for CMO tools field
  console.log('\n=== CMO BRIEF (tools) ===');
  const brief = await c.query(`SELECT agent_role, tools FROM agent_briefs WHERE agent_role = 'cmo' ORDER BY created_at DESC LIMIT 1`);
  for (const r of brief.rows) console.log(`Tools: ${JSON.stringify(r.tools)}`);

  // What model the CMO is configured to use in the DB
  console.log('\n=== CMO AGENT PROFILE ===');
  const prof = await c.query(`SELECT * FROM company_agents WHERE role = 'cmo'`);
  for (const r of prof.rows) {
    const keys = Object.keys(r);
    for (const k of keys) {
      const v = r[k];
      if (v !== null && v !== undefined) {
        const s = String(v);
        if (s.length < 300) console.log(`  ${k}: ${s}`);
        else console.log(`  ${k}: [${s.length} chars]`);
      }
    }
  }

  await c.end();
})();
