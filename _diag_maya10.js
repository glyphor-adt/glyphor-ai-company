const { Client } = require('pg');
const c = new Client({ host:'127.0.0.1', port:5434, user:'glyphor_app', password:'lGHMxoC8zpmngKUaYv9cOTwJ', database:'glyphor' });

(async()=>{
  await c.connect();

  // CMO generate_content run details (scheduled that succeeded at 19:00)
  console.log('=== CMO SCHEDULED RUNS (last 24h) ===');
  const sched = await c.query(`
    SELECT task, status, input_tokens, output_tokens, thinking_tokens, 
           tool_calls, turns, duration_ms, error, started_at
    FROM agent_runs
    WHERE agent_id = 'cmo' 
      AND task != 'on_demand'
      AND started_at > NOW() - INTERVAL '24 hours'
    ORDER BY started_at DESC
  `);
  for (const r of sched.rows) {
    console.log(`${r.task} | ${r.status} | in=${r.input_tokens} out=${r.output_tokens} think=${r.thinking_tokens} | tools=${r.tool_calls} turns=${r.turns} | ${r.duration_ms}ms | ${(r.error||'').substring(0,100)}`);
  }

  // Count tools for content-creator (also has Pulse tools)
  console.log('\n=== TOOL GRANT COUNTS (marketing agents) ===');
  const tgc = await c.query(`
    SELECT agent_role, COUNT(*) as cnt
    FROM agent_tool_grants 
    WHERE agent_role IN ('cmo','content-creator','social-media-manager','chief-of-staff','cto','cfo')
    AND is_active = true
    GROUP BY agent_role
    ORDER BY cnt DESC
  `);
  for (const r of tgc.rows) console.log(`${r.agent_role}: ${r.cnt} tools`);

  // Check content-creator recent on_demand success/failure
  console.log('\n=== CONTENT-CREATOR RECENT RUNS ===');
  const cc = await c.query(`
    SELECT task, status, input_tokens, output_tokens, error, started_at
    FROM agent_runs
    WHERE agent_id = 'content-creator'
    AND started_at > NOW() - INTERVAL '3 days'
    ORDER BY started_at DESC
    LIMIT 10
  `);
  for (const r of cc.rows) {
    console.log(`${r.task} | ${r.status} | in=${r.input_tokens} out=${r.output_tokens} | ${(r.error||'OK').substring(0,80)} | ${r.started_at}`);
  }

  // Check dynamic tools from tool_registry
  console.log('\n=== DYNAMIC TOOLS (tool_registry) ===');
  const dyn = await c.query(`SELECT name, is_active FROM runtime_tools WHERE is_active = true ORDER BY name`);
  console.log(`Active dynamic tools: ${dyn.rows.length}`);
  for (const r of dyn.rows) console.log(`  ${r.name}`);

  await c.end();
})();
