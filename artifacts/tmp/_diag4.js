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

  // 1. Social-media-manager + temp agents
  console.log('=== COMPANY_AGENTS: social-media / temporary ===');
  const smm = await c.query(`
    SELECT role, display_name, status, is_temporary, is_core, expires_at, 
           department, created_by, created_via, created_at, updated_at,
           substring(last_run_summary from 1 for 300) as last_summary
    FROM company_agents 
    WHERE role ILIKE '%social-media%' OR role ILIKE '%temporary%' 
       OR is_temporary = true
    ORDER BY created_at DESC
  `);
  console.log(JSON.stringify(smm.rows, null, 2));

  // 2. Founder directives (proposed/active)
  console.log('\n=== FOUNDER_DIRECTIVES (proposed/active) ===');
  const dir = await c.query(`
    SELECT id, title, status, priority, proposed_by, 
           substring(description from 1 for 200) as descr, created_at
    FROM founder_directives 
    WHERE status IN ('proposed', 'active')
    ORDER BY created_at DESC LIMIT 15
  `);
  console.log(JSON.stringify(dir.rows, null, 2));

  // 3. Pending decisions
  console.log('\n=== DECISIONS (pending/proposed) ===');
  const dec = await c.query(`
    SELECT id, title, status, decision_type, proposed_by,
           substring(description from 1 for 200) as descr, created_at
    FROM decisions 
    WHERE status IN ('pending', 'proposed')
    ORDER BY created_at DESC LIMIT 15
  `);
  console.log(JSON.stringify(dec.rows, null, 2));

  // 4. Agent_activities related to specialist creation
  console.log('\n=== AGENT_ACTIVITIES: specialist/social-media (last 12h) ===');
  const acts = await c.query(`
    SELECT id, agent_id, activity_type, 
           substring(summary from 1 for 400) as summary,
           substring(details::text from 1 for 300) as details,
           created_at
    FROM agent_activities 
    WHERE created_at > now() - interval '24 hours'
      AND (summary ILIKE '%specialist%' OR summary ILIKE '%social-media%' 
           OR summary ILIKE '%create_specialist%' OR summary ILIKE '%temporary%')
    ORDER BY created_at DESC LIMIT 10
  `);
  console.log(JSON.stringify(acts.rows, null, 2));

  // 5. Recent CMO output
  console.log('\n=== CMO RECENT RUNS ===');
  const cmo = await c.query(`
    SELECT id, status, tool_calls, 
           substring(output from 1 for 1500) as out,
           substring(error from 1 for 300) as err,
           created_at
    FROM agent_runs 
    WHERE agent_id = 'cmo' AND created_at > now() - interval '12 hours'
    ORDER BY created_at DESC LIMIT 3
  `);
  console.log(JSON.stringify(cmo.rows, null, 2));

  // 6. Agent tool grants pending
  console.log('\n=== AGENT_TOOL_GRANTS (pending) ===');
  const grants = await c.query(`
    SELECT id, agent_id, tool_name, status, requested_by, reason,
           created_at
    FROM agent_tool_grants 
    WHERE status = 'pending'
    ORDER BY created_at DESC LIMIT 10
  `);
  console.log(JSON.stringify(grants.rows, null, 2));

  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
