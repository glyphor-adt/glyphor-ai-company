require('dotenv').config();
const { Client } = require('pg');

function buildConfig() {
  if (process.env.DB_HOST && process.env.DB_NAME && process.env.DB_USER && process.env.DB_PASSWORD) {
    return {
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 5432),
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      ssl: { rejectUnauthorized: false },
    };
  }

  return {
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  };
}

async function main() {
  const client = new Client(buildConfig());
  await client.connect();

  const sql = [
    "ALTER TABLE company_agents ADD COLUMN IF NOT EXISTS knowledge_access_scope TEXT[] NOT NULL DEFAULT ARRAY['general'];",
    'ALTER TABLE company_agents ADD COLUMN IF NOT EXISTS tenant_id UUID;',
    "ALTER TABLE company_agents ALTER COLUMN tenant_id SET DEFAULT '00000000-0000-0000-0000-000000000000';",
    "UPDATE company_agents SET tenant_id = '00000000-0000-0000-0000-000000000000' WHERE tenant_id IS NULL;",
    'ALTER TABLE company_agents ALTER COLUMN tenant_id SET NOT NULL;',
    "ALTER TABLE company_agents ADD COLUMN IF NOT EXISTS created_via TEXT DEFAULT 'internal';",
    'ALTER TABLE company_agents ADD COLUMN IF NOT EXISTS created_by_client_id UUID;',
    "ALTER TABLE company_agents ADD COLUMN IF NOT EXISTS authority_scope TEXT DEFAULT 'green';",
    'ALTER TABLE agent_profiles ADD COLUMN IF NOT EXISTS tenant_id UUID;',
    "ALTER TABLE agent_profiles ALTER COLUMN tenant_id SET DEFAULT '00000000-0000-0000-0000-000000000000';",
    "UPDATE agent_profiles SET tenant_id = '00000000-0000-0000-0000-000000000000' WHERE tenant_id IS NULL;",
    'ALTER TABLE agent_profiles ALTER COLUMN tenant_id SET NOT NULL;',
  ].join('\n');

  await client.query(sql);
  const who = await client.query('SELECT current_user');
  console.log('Schema patch applied successfully as user:', who.rows?.[0]?.current_user);
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

