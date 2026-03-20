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

  // 1. Pending decisions
  console.log('=== DECISIONS (pending/proposed) ===');
  const dec = await c.query(`
    SELECT id, title, tier, status, proposed_by,
           substring(summary from 1 for 300) as summary, created_at
    FROM decisions 
    WHERE status IN ('pending', 'proposed')
    ORDER BY created_at DESC LIMIT 15
  `);
  console.log(JSON.stringify(dec.rows, null, 2));

  // 2. CMO all recent runs
  console.log('\n=== CMO RECENT RUNS ===');
  const cmo = await c.query(`
    SELECT id, status, tool_calls, 
           substring(output from 1 for 1500) as out,
           substring(error from 1 for 300) as err,
           created_at
    FROM agent_runs 
    WHERE agent_id = 'cmo' AND created_at > now() - interval '14 hours'
    ORDER BY created_at DESC LIMIT 5
  `);
  console.log(JSON.stringify(cmo.rows, null, 2));

  // 3. Activity log - specialist creation
  console.log('\n=== AGENT_ACTIVITIES: specialist/temp ===');
  const act = await c.query(`
    SELECT id, agent_id, activity_type,
           substring(summary from 1 for 400) as summary,
           created_at
    FROM agent_activities 
    WHERE created_at > now() - interval '24 hours'
      AND (summary ILIKE '%specialist%' OR summary ILIKE '%social-media%' 
           OR summary ILIKE '%temporary%' OR activity_type ILIKE '%creat%')
    ORDER BY created_at DESC LIMIT 15
  `);
  console.log(JSON.stringify(act.rows, null, 2));

  // 4. Social-media-manager schedule and run history
  console.log('\n=== SOCIAL-MEDIA-MANAGER SCHEDULE + RUNS ===');
  const sched = await c.query(`
    SELECT role, status, schedule_cron, last_run_at, 
           substring(last_run_summary from 1 for 300) as summary
    FROM company_agents WHERE role = 'social-media-manager'
  `);
  console.log(JSON.stringify(sched.rows, null, 2));

  const smmRuns = await c.query(`
    SELECT id, status, tool_calls, 
           substring(output from 1 for 500) as out,
           substring(error from 1 for 300) as err,
           created_at
    FROM agent_runs 
    WHERE agent_id = 'social-media-manager' 
    ORDER BY created_at DESC LIMIT 5
  `);
  console.log(JSON.stringify(smmRuns.rows, null, 2));

  // 5. Tool risk
  console.log('\n=== TOOL RISK ===');
  const risk = await c.query(`
    SELECT tool_name, risk_tier, requires_approval, status
    FROM agent_tool_risk 
    WHERE tool_name ILIKE '%specialist%' OR tool_name ILIKE '%create_decision%'
       OR tool_name ILIKE '%create_agent%'
    ORDER BY tool_name
  `);
  console.log(JSON.stringify(risk.rows, null, 2));

  // 6. Active temp agents count
  console.log('\n=== ACTIVE TEMP COUNT ===');
  const temps = await c.query(`
    SELECT count(*) as total, 
           count(*) FILTER (WHERE status = 'active') as active,
           count(*) FILTER (WHERE status = 'retired') as retired
    FROM company_agents WHERE is_temporary = true
  `);
  console.log(JSON.stringify(temps.rows[0]));

  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
