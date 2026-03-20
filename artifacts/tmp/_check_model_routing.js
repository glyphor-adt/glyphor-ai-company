const { Client } = require('pg');

(async () => {
  const c = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });
  await c.connect();

  // 1. What does routing_config say?
  const q1 = await c.query(`
    SELECT route_name, model_slug, priority, is_active
    FROM routing_config
    ORDER BY priority DESC
  `);
  console.log('=== ROUTING_CONFIG ===');
  console.log(JSON.stringify(q1.rows, null, 2));

  // 2. What models are agents assigned to?
  const q2 = await c.query(`
    SELECT role, model, updated_at
    FROM company_agents
    WHERE model ILIKE '%2.5-pro%' OR model ILIKE '%2.5-flash%' OR model ILIKE '%3-flash%'
    ORDER BY role
  `);
  console.log('\n=== AGENTS STILL ON 2.5-PRO / OLD MODELS ===');
  console.log(JSON.stringify(q2.rows, null, 2));

  // 3. All agent models
  const q3 = await c.query(`
    SELECT model, COUNT(*) as agent_count, array_agg(role ORDER BY role) as roles
    FROM company_agents
    GROUP BY model
    ORDER BY agent_count DESC
  `);
  console.log('\n=== ALL AGENT MODEL ASSIGNMENTS ===');
  console.log(JSON.stringify(q3.rows, null, 2));

  // 4. Check if migrations were applied
  const q4 = await c.query(`
    SELECT filename, applied_at
    FROM migration_ledger
    WHERE filename ILIKE '%route_orchestration%' OR filename ILIKE '%clear_model_overrides%' OR filename ILIKE '%retire_gemini%'
    ORDER BY applied_at DESC
  `);
  console.log('\n=== RELEVANT MIGRATIONS APPLIED ===');
  console.log(JSON.stringify(q4.rows, null, 2));

  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
