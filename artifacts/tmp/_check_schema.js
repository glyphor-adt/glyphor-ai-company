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

  const q1 = await c.query("SELECT column_name FROM information_schema.columns WHERE table_name='routing_config' ORDER BY ordinal_position");
  console.log('routing_config cols:', q1.rows.map(r => r.column_name));

  const q2 = await c.query("SELECT column_name FROM information_schema.columns WHERE table_name='model_registry' ORDER BY ordinal_position");
  console.log('model_registry cols:', q2.rows.map(r => r.column_name));

  const q3 = await c.query("SELECT route_name, model_slug FROM routing_config WHERE model_slug='gemini-2.5-pro'");
  console.log('routes still on 2.5-pro:', q3.rows);

  const q4 = await c.query("SELECT role, model FROM company_agents WHERE model='gemini-2.5-pro'");
  console.log('agents still on 2.5-pro:', q4.rows);

  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
