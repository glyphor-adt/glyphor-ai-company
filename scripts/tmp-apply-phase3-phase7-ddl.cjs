require('dotenv').config();
const { Client } = require('pg');

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  const sql = [
    "ALTER TABLE company_agents ADD COLUMN IF NOT EXISTS knowledge_access_scope TEXT[] NOT NULL DEFAULT ARRAY['general'];",
    'ALTER TABLE company_agents ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);',
    "ALTER TABLE company_agents ALTER COLUMN tenant_id SET DEFAULT '00000000-0000-0000-0000-000000000000';",
    "UPDATE company_agents SET tenant_id = '00000000-0000-0000-0000-000000000000' WHERE tenant_id IS NULL;",
    'ALTER TABLE company_agents ALTER COLUMN tenant_id SET NOT NULL;',
    "ALTER TABLE company_agents ADD COLUMN IF NOT EXISTS created_via TEXT DEFAULT 'internal';",
    'ALTER TABLE company_agents ADD COLUMN IF NOT EXISTS created_by_client_id UUID REFERENCES a2a_clients(id);',
    "ALTER TABLE company_agents ADD COLUMN IF NOT EXISTS authority_scope TEXT DEFAULT 'green';",
    'ALTER TABLE agent_profiles ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);',
    "ALTER TABLE agent_profiles ALTER COLUMN tenant_id SET DEFAULT '00000000-0000-0000-0000-000000000000';",
    "UPDATE agent_profiles SET tenant_id = '00000000-0000-0000-0000-000000000000' WHERE tenant_id IS NULL;",
    'ALTER TABLE agent_profiles ALTER COLUMN tenant_id SET NOT NULL;',
  ].join('\n');

  await client.query(sql);
  await client.end();
  console.log('Schema patch applied successfully.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
