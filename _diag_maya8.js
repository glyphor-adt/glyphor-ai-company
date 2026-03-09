const { Client } = require('pg');
const c = new Client({ host:'127.0.0.1', port:5434, user:'glyphor_app', password:'lGHMxoC8zpmngKUaYv9cOTwJ', database:'glyphor' });

(async()=>{
  await c.connect();

  // Compare token counts: CMO vs chief-of-staff on_demand runs
  console.log('=== CMO vs COS on_demand TOKEN COMPARISON ===');
  const comp = await c.query(`
    SELECT agent_id, status, input_tokens, output_tokens, thinking_tokens, cached_input_tokens, error,
           started_at, duration_ms, tool_calls, turns
    FROM agent_runs
    WHERE agent_id IN ('cmo','chief-of-staff')
      AND task = 'on_demand'
      AND started_at > NOW() - INTERVAL '3 days'
    ORDER BY agent_id, started_at DESC
    LIMIT 20
  `);
  for (const r of comp.rows) {
    console.log(`${r.agent_id} | ${r.status} | in=${r.input_tokens} out=${r.output_tokens} think=${r.thinking_tokens} cached=${r.cached_input_tokens} | tools=${r.tool_calls} turns=${r.turns} | ${r.duration_ms}ms | ${(r.error||'').substring(0,80)}`);
  }

  // Check what MCP tools are configured for CMO
  console.log('\n=== MCP TOOL CONFIG FOR CMO ===');
  const mcp = await c.query(`
    SELECT table_name FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND (table_name LIKE '%tool%' OR table_name LIKE '%mcp%' OR table_name LIKE '%config%' OR table_name LIKE '%agent_config%')
    ORDER BY table_name
  `);
  for (const r of mcp.rows) console.log(r.table_name);

  // Check if there's an agent_config or similar table
  console.log('\n=== AGENT CONFIG TABLES ===');
  const cfg = await c.query(`
    SELECT table_name FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name LIKE '%agent%'
    ORDER BY table_name
  `);
  for (const r of cfg.rows) console.log(r.table_name);

  // Check tool_reputation for CMO-related entries
  console.log('\n=== TOOL REPUTATION CMO ===');
  try {
    const tr = await c.query(`SELECT * FROM tool_reputation WHERE agent_role = 'cmo' ORDER BY last_used_at DESC NULLS LAST LIMIT 10`);
    for (const r of tr.rows) console.log(`${r.tool_name} | success=${r.success_count} fail=${r.failure_count} | ${r.last_used_at}`);
  } catch(e) { console.log('Error:', e.message); }

  // Check if there's an MCP server connection/config table 
  console.log('\n=== ALL TABLES WITH TOOL/MCP ===');
  const allTables = await c.query(`
    SELECT table_name, column_name FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND (table_name LIKE '%tool%' OR table_name LIKE '%mcp%' OR column_name LIKE '%tool%' OR column_name LIKE '%mcp%')
    ORDER BY table_name, ordinal_position
  `);
  for (const r of allTables.rows) console.log(`${r.table_name}.${r.column_name}`);

  // Check the needsThinking logic — look at what makes a message "need thinking"
  // Also check what the CMO error at 01:42 was about
  console.log('\n=== CMO ERROR DETAILS (01:42 run) ===');
  const err = await c.query(`
    SELECT id, agent_id, task, status, error, input_tokens, output_tokens, 
           LEFT(input::text, 500) as input_preview, LEFT(output::text, 500) as output_preview,
           tool_calls, turns, reasoning_passes, reasoning_confidence
    FROM agent_runs
    WHERE agent_id = 'cmo' AND task = 'on_demand'
    AND started_at > '2026-03-09 01:40:00'
    AND started_at < '2026-03-09 01:45:00'
    ORDER BY started_at
  `);
  for (const r of err.rows) {
    console.log(`Status: ${r.status} | Error: ${r.error}`);
    console.log(`Input: ${r.input_preview}`);
    console.log(`Output: ${r.output_preview}`);
    console.log(`Reasoning: passes=${r.reasoning_passes} conf=${r.reasoning_confidence}`);
    console.log('---');
  }

  await c.end();
})();
