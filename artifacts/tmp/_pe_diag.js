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

  // 1. Platform-engineer memory about stripe/api-gateway/secrets
  console.log('=== PLATFORM-ENGINEER MEMORY (infra) ===');
  const mem = await c.query(`
    SELECT memory_type, substring(content from 1 for 500) as content, 
           importance, created_at
    FROM agent_memory 
    WHERE agent_role = 'platform-engineer'
      AND (content ILIKE '%stripe%' OR content ILIKE '%api-gateway%' 
           OR content ILIKE '%secret%' OR content ILIKE '%deploy%')
    ORDER BY created_at DESC LIMIT 10
  `);
  console.log(JSON.stringify(mem.rows, null, 2));

  // 2. ALL platform-engineer memory (recent, to see what it "knows")
  console.log('\n=== PLATFORM-ENGINEER ALL RECENT MEMORY ===');
  const allMem = await c.query(`
    SELECT memory_type, substring(content from 1 for 300) as content,
           importance, created_at
    FROM agent_memory 
    WHERE agent_role = 'platform-engineer'
    ORDER BY created_at DESC LIMIT 15
  `);
  console.log(JSON.stringify(allMem.rows, null, 2));

  // 3. CTO memory about api-gateway / stripe
  console.log('\n=== CTO MEMORY (stripe/deploy) ===');
  const ctoMem = await c.query(`
    SELECT memory_type, substring(content from 1 for 500) as content,
           importance, created_at
    FROM agent_memory 
    WHERE agent_role = 'cto'
      AND (content ILIKE '%stripe%' OR content ILIKE '%api-gateway%'
           OR content ILIKE '%secret%' OR content ILIKE '%deploy%')
    ORDER BY created_at DESC LIMIT 10
  `);
  console.log(JSON.stringify(ctoMem.rows, null, 2));

  // 4. What tools does platform-engineer have for checking secrets?
  console.log('\n=== PLATFORM-ENGINEER TOOL GRANTS ===');
  const grants = await c.query(`
    SELECT tool_name, status, requested_by, reason, created_at
    FROM agent_tool_grants
    WHERE agent_id = 'platform-engineer'
    ORDER BY created_at DESC LIMIT 10
  `);
  console.log(JSON.stringify(grants.rows, null, 2));

  // 5. Who triggered the gcp_create_secret request? Check the decision chain
  console.log('\n=== DECISION CHAIN FOR GCP_CREATE_SECRET ===');
  const chain = await c.query(`
    SELECT dc.* FROM decision_chains dc
    JOIN decisions d ON d.id = dc.decision_id OR d.id = dc.parent_decision_id
    WHERE d.title ILIKE '%gcp_create_secret%' OR d.title ILIKE '%STRIPE%'
    ORDER BY dc.created_at DESC LIMIT 5
  `);
  console.log(JSON.stringify(chain.rows, null, 2));

  // 6. The specific gcp_create_secret decision detail 
  console.log('\n=== GCP_CREATE_SECRET DECISION DETAIL ===');
  const dec = await c.query(`
    SELECT id, title, tier, status, proposed_by,
           summary, reasoning,
           data::text as data_raw,
           created_at
    FROM decisions 
    WHERE title ILIKE '%gcp_create_secret%'
    ORDER BY created_at DESC LIMIT 3
  `);
  console.log(JSON.stringify(dec.rows, null, 2));

  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
