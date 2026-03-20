const { Client } = require('pg');

(async () => {
  const c = new Client({
    host: process.env.DB_HOST,
    port: +process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });
  await c.connect();

  // 1. Find relevant tables
  console.log('=== TABLES ===');
  const tables = await c.query(`
    SELECT table_name FROM information_schema.tables 
    WHERE table_schema='public' 
    AND (table_name LIKE '%agent%' OR table_name LIKE '%specialist%' 
         OR table_name LIKE '%role%' OR table_name LIKE '%directive%'
         OR table_name LIKE '%decision%')
    ORDER BY table_name
  `);
  console.log(tables.rows.map(x => x.table_name));

  // 2. Check agent_configs for social-media-manager
  console.log('\n=== SOCIAL-MEDIA-MANAGER CONFIG ===');
  try {
    const smm = await c.query(`
      SELECT * FROM agent_configs WHERE agent_id = 'social-media-manager'
    `);
    console.log(JSON.stringify(smm.rows, null, 2));
  } catch (e) {
    console.log('agent_configs not found, trying agent_roster...');
    try {
      const smm2 = await c.query(`
        SELECT * FROM agent_roster WHERE agent_id = 'social-media-manager'
      `);
      console.log(JSON.stringify(smm2.rows, null, 2));
    } catch (e2) {
      console.log('Not in agent_roster either:', e2.message);
    }
  }

  // 3. Look at tool calls for create_specialist_agent
  console.log('\n=== SPECIALIST TOOL CALLS (last 12h) ===');
  const toolCalls = await c.query(`
    SELECT run_id, tool_name, status, 
           substring(error from 1 for 500) as err,
           substring(result from 1 for 300) as result,
           created_at
    FROM agent_tool_calls 
    WHERE (tool_name ILIKE '%specialist%' OR tool_name ILIKE '%create_agent%')
      AND created_at > now() - interval '24 hours'
    ORDER BY created_at DESC LIMIT 10
  `);
  console.log(JSON.stringify(toolCalls.rows, null, 2));

  // 4. Directives
  console.log('\n=== PROPOSED/ACTIVE DIRECTIVES ===');
  const dir = await c.query(`
    SELECT id, title, status, priority, proposed_by, 
           substring(description from 1 for 200) as descr, created_at
    FROM directives 
    WHERE status IN ('proposed', 'active')
    ORDER BY created_at DESC LIMIT 10
  `);
  console.log(JSON.stringify(dir.rows, null, 2));

  // 5. Pending decisions
  console.log('\n=== PENDING DECISIONS ===');
  const dec = await c.query(`
    SELECT id, title, status, decision_type, proposed_by,
           substring(description from 1 for 200) as descr, created_at
    FROM decisions 
    WHERE status IN ('pending', 'proposed')
    ORDER BY created_at DESC LIMIT 10
  `);
  console.log(JSON.stringify(dec.rows, null, 2));

  // 6. Recent CMO runs output
  console.log('\n=== RECENT CMO RUNS (output) ===');
  const cmo = await c.query(`
    SELECT id, status, tool_calls, 
           substring(output from 1 for 800) as out,
           substring(error from 1 for 300) as err,
           created_at
    FROM agent_runs 
    WHERE agent_id = 'cmo' AND created_at > now() - interval '12 hours'
    ORDER BY created_at DESC LIMIT 5
  `);
  console.log(JSON.stringify(cmo.rows, null, 2));

  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
