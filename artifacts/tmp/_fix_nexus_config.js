const {Client} = require('pg');
(async () => {
  const c = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });
  await c.connect();

  // Fix agent config: model, department
  const r1 = await c.query(`
    UPDATE company_agents SET
      model = 'claude-opus-4-6',
      department = 'Operations',
      thinking_enabled = true,
      temperature = 1.0,
      max_turns = 40,
      reports_to = NULL,
      is_core = true,
      budget_per_run = 0.50,
      budget_daily = 2.00
    WHERE role = 'platform-intel'
    RETURNING role, model, department, max_turns
  `);
  console.log('UPDATED:', JSON.stringify(r1.rows, null, 2));

  await c.end();
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
