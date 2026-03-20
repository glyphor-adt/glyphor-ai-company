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

  // 1. Recent failed runs for the noisy agents
  console.log('=== RECENT FAILED RUNS ===');
  const failed = await c.query(`
    SELECT agent_id, status, substring(task from 1 for 200) as task, 
           tool_calls, substring(error from 1 for 500) as err, created_at
    FROM agent_runs 
    WHERE agent_id IN ('cmo','chief-of-staff','cto','platform-engineer')
      AND created_at > now() - interval '12 hours'
      AND (status = 'failed' OR error IS NOT NULL)
    ORDER BY created_at DESC LIMIT 15
  `);
  console.log(JSON.stringify(failed.rows, null, 2));

  // 2. Check social-media-manager agent status
  console.log('\n=== SOCIAL-MEDIA-MANAGER AGENT STATUS ===');
  const smm = await c.query(`
    SELECT id, agent_id, role_title, status, paused, paused_reason, 
           created_at, updated_at
    FROM agents 
    WHERE agent_id = 'social-media-manager'
  `);
  console.log(JSON.stringify(smm.rows, null, 2));

  // 3. Check temp specialist agents created
  console.log('\n=== TEMP SPECIALIST AGENTS ===');
  const temps = await c.query(`
    SELECT id, agent_id, role_title, status, paused, 
           substring(paused_reason from 1 for 200) as reason,
           created_at
    FROM agents 
    WHERE agent_id LIKE '%social-media%' OR agent_id LIKE '%temporary%'
    ORDER BY created_at DESC LIMIT 10
  `);
  console.log(JSON.stringify(temps.rows, null, 2));

  // 4. Tool call errors related to create_specialist_agent
  console.log('\n=== CREATE_SPECIALIST_AGENT TOOL CALLS ===');
  const toolCalls = await c.query(`
    SELECT run_id, tool_name, status, 
           substring(error from 1 for 500) as err,
           substring(result from 1 for 300) as result,
           created_at
    FROM agent_tool_calls 
    WHERE tool_name ILIKE '%specialist%' OR tool_name ILIKE '%create_agent%'
    AND created_at > now() - interval '12 hours'
    ORDER BY created_at DESC LIMIT 10
  `);
  console.log(JSON.stringify(toolCalls.rows, null, 2));

  // 5. Recent directives in proposed status
  console.log('\n=== PROPOSED DIRECTIVES ===');
  const directives = await c.query(`
    SELECT id, title, status, priority, proposed_by, 
           substring(description from 1 for 200) as descr,
           created_at
    FROM directives 
    WHERE status = 'proposed'
    ORDER BY created_at DESC LIMIT 10
  `);
  console.log(JSON.stringify(directives.rows, null, 2));

  // 6. Recent decisions pending
  console.log('\n=== PENDING DECISIONS ===');
  const decisions = await c.query(`
    SELECT id, title, status, decision_type, proposed_by,
           substring(description from 1 for 200) as descr,
           created_at
    FROM decisions 
    WHERE status IN ('pending', 'proposed')
    ORDER BY created_at DESC LIMIT 10
  `);
  console.log(JSON.stringify(decisions.rows, null, 2));

  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
