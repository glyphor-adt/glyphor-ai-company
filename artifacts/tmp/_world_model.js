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

  // 1. Agent world model - what do agents believe about infrastructure/secrets
  console.log('=== AGENT_WORLD_MODEL (infra/secret related) ===');
  try {
    const wm = await c.query(`
      SELECT agent_id, category, key, 
             substring(value::text from 1 for 500) as val,
             confidence, updated_at
      FROM agent_world_model 
      WHERE key ILIKE '%stripe%' OR key ILIKE '%secret%' OR key ILIKE '%api-gateway%'
         OR value::text ILIKE '%stripe%' OR value::text ILIKE '%STRIPE%'
      ORDER BY updated_at DESC LIMIT 20
    `);
    console.log(JSON.stringify(wm.rows, null, 2));
  } catch (e) {
    console.log('world_model query failed:', e.message);
  }

  // 2. Platform engineer recent runs + outputs
  console.log('\n=== PLATFORM-ENGINEER RECENT RUNS ===');
  const pe = await c.query(`
    SELECT id, status, tool_calls, 
           substring(output from 1 for 1500) as out,
           substring(error from 1 for 300) as err,
           created_at
    FROM agent_runs 
    WHERE agent_id = 'platform-engineer' AND created_at > now() - interval '24 hours'
    ORDER BY created_at DESC LIMIT 5
  `);
  console.log(JSON.stringify(pe.rows, null, 2));

  // 3. Agent memory for platform-engineer about stripe or api-gateway
  console.log('\n=== AGENT_MEMORY (platform-engineer) ===');
  try {
    const mem = await c.query(`
      SELECT agent_id, key, 
             substring(value::text from 1 for 500) as val,
             updated_at
      FROM agent_memory 
      WHERE agent_id = 'platform-engineer'
      ORDER BY updated_at DESC LIMIT 10
    `);
    console.log(JSON.stringify(mem.rows, null, 2));
  } catch (e) {
    console.log('memory query failed:', e.message);
  }

  // 4. CTO world model / memory about stripe
  console.log('\n=== CTO WORLD MODEL (stripe/secret) ===');
  try {
    const cto = await c.query(`
      SELECT agent_id, category, key, 
             substring(value::text from 1 for 500) as val,
             confidence, updated_at
      FROM agent_world_model 
      WHERE agent_id = 'cto' 
        AND (key ILIKE '%stripe%' OR key ILIKE '%secret%' OR key ILIKE '%deploy%'
             OR value::text ILIKE '%stripe%')
      ORDER BY updated_at DESC LIMIT 10
    `);
    console.log(JSON.stringify(cto.rows, null, 2));
  } catch (e) {
    console.log('cto world model query failed:', e.message);
  }

  // 5. All world model entries about missing/failing infrastructure
  console.log('\n=== WORLD MODEL: failing/missing beliefs ===');
  try {
    const fails = await c.query(`
      SELECT agent_id, category, key,
             substring(value::text from 1 for 300) as val,
             confidence, updated_at
      FROM agent_world_model 
      WHERE (value::text ILIKE '%missing%' OR value::text ILIKE '%fail%' 
             OR value::text ILIKE '%block%' OR value::text ILIKE '%broken%')
        AND updated_at > now() - interval '24 hours'
      ORDER BY updated_at DESC LIMIT 20
    `);
    console.log(JSON.stringify(fails.rows, null, 2));
  } catch (e) {
    console.log('failing beliefs query failed:', e.message);
  }

  // 6. World model corrections (did anyone correct false beliefs?)
  console.log('\n=== WORLD MODEL CORRECTIONS (last 24h) ===');
  try {
    const corr = await c.query(`
      SELECT * FROM agent_world_model_corrections
      WHERE created_at > now() - interval '24 hours'
      ORDER BY created_at DESC LIMIT 10
    `);
    console.log(JSON.stringify(corr.rows, null, 2));
  } catch (e) {
    console.log('corrections query failed:', e.message);
  }

  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
