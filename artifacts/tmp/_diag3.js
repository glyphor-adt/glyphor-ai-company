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

  // 1. Social-media-manager in company_agents
  console.log('=== COMPANY_AGENTS - social-media-manager ===');
  const smm = await c.query(`
    SELECT * FROM company_agents 
    WHERE agent_id ILIKE '%social-media%' OR agent_id ILIKE '%temporary%'
    ORDER BY created_at DESC
  `);
  console.log(JSON.stringify(smm.rows, null, 2));

  // 2. company_agents columns
  console.log('\n=== COMPANY_AGENTS COLUMNS ===');
  const cols = await c.query(`
    SELECT column_name, data_type FROM information_schema.columns 
    WHERE table_name = 'company_agents' ORDER BY ordinal_position
  `);
  console.log(cols.rows.map(r => `${r.column_name} (${r.data_type})`));

  // 3. Pending directives
  console.log('\n=== FOUNDER_DIRECTIVES (proposed/active) ===');
  const dir = await c.query(`
    SELECT id, title, status, priority, proposed_by, 
           substring(description from 1 for 200) as descr, created_at
    FROM founder_directives 
    WHERE status IN ('proposed', 'active')
    ORDER BY created_at DESC LIMIT 15
  `);
  console.log(JSON.stringify(dir.rows, null, 2));

  // 4. Pending decisions
  console.log('\n=== DECISIONS (pending) ===');
  const dec = await c.query(`
    SELECT id, title, status, decision_type, proposed_by,
           substring(description from 1 for 200) as descr, created_at
    FROM decisions 
    WHERE status IN ('pending', 'proposed')
    ORDER BY created_at DESC LIMIT 15
  `);
  console.log(JSON.stringify(dec.rows, null, 2));

  // 5. Recent CMO runs
  console.log('\n=== CMO RECENT RUNS ===');
  const cmo = await c.query(`
    SELECT id, status, tool_calls, 
           substring(output from 1 for 1000) as out,
           substring(error from 1 for 300) as err,
           created_at
    FROM agent_runs 
    WHERE agent_id = 'cmo' AND created_at > now() - interval '12 hours'
    ORDER BY created_at DESC LIMIT 5
  `);
  console.log(JSON.stringify(cmo.rows, null, 2));

  // 6. Recent CTO runs
  console.log('\n=== CTO RECENT RUNS ===');
  const cto = await c.query(`
    SELECT id, status, tool_calls, 
           substring(output from 1 for 1000) as out,
           substring(error from 1 for 300) as err,
           created_at
    FROM agent_runs 
    WHERE agent_id = 'cto' AND created_at > now() - interval '12 hours'
    ORDER BY created_at DESC LIMIT 5
  `);
  console.log(JSON.stringify(cto.rows, null, 2));

  // 7. Recent CoS runs  
  console.log('\n=== CoS RECENT RUNS ===');
  const cos = await c.query(`
    SELECT id, status, tool_calls, 
           substring(output from 1 for 1000) as out,
           substring(error from 1 for 300) as err,
           created_at
    FROM agent_runs 
    WHERE agent_id = 'chief-of-staff' AND created_at > now() - interval '12 hours'
    ORDER BY created_at DESC LIMIT 5
  `);
  console.log(JSON.stringify(cos.rows, null, 2));

  // 8. tenant_agents for specialists
  console.log('\n=== TENANT_AGENTS (specialists) ===');
  const ta = await c.query(`
    SELECT * FROM tenant_agents 
    WHERE agent_id ILIKE '%social%' OR agent_id ILIKE '%temporary%' OR agent_id ILIKE '%specialist%'
    ORDER BY created_at DESC LIMIT 10
  `);
  console.log(JSON.stringify(ta.rows, null, 2));

  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
