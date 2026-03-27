import pg from 'pg';
const { Client } = pg;

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  // 1. Show current model assignments for the 3 retired models
  console.log('=== Agents on Retired Gemini Models ===\n');
  const agents = await client.query(`
    SELECT role, display_name, model, status
    FROM company_agents
    WHERE model IN ('gemini-3.1-pro-preview', 'gemini-3-flash-preview', 'gemini-2.5-flash')
    ORDER BY model, role
  `);
  console.table(agents.rows);
  console.log(`Total: ${agents.rows.length} agents\n`);

  // 2. Also check verification_models arrays
  console.log('=== Verification Models Containing Retired Models ===\n');
  const verif = await client.query(`
    SELECT role, verification_models
    FROM company_agents
    WHERE verification_models IS NOT NULL
      AND (
        'gemini-3.1-pro-preview' = ANY(verification_models)
        OR 'gemini-3-flash-preview' = ANY(verification_models)
        OR 'gemini-2.5-flash' = ANY(verification_models)
      )
  `);
  console.table(verif.rows);

  // 3. Migrate: model-router for agents currently on gemini-3-flash-preview or gemini-2.5-flash
  //    gpt-5.4 for agents on gemini-3.1-pro-preview (flagship replacement)
  console.log('\n=== Migrating Agents ===\n');

  const r1 = await client.query(`
    UPDATE company_agents
    SET model = 'model-router', updated_at = NOW()
    WHERE model IN ('gemini-3-flash-preview', 'gemini-2.5-flash')
    RETURNING role, display_name, model
  `);
  console.log(`Migrated ${r1.rowCount} agents from gemini-3-flash-preview / gemini-2.5-flash → model-router`);
  if (r1.rows.length > 0) console.table(r1.rows);

  const r2 = await client.query(`
    UPDATE company_agents
    SET model = 'model-router', updated_at = NOW()
    WHERE model = 'gemini-3.1-pro-preview'
    RETURNING role, display_name, model
  `);
  console.log(`Migrated ${r2.rowCount} agents from gemini-3.1-pro-preview → model-router`);
  if (r2.rows.length > 0) console.table(r2.rows);

  // 4. Fix verification_models arrays — replace retired models
  const r3 = await client.query(`
    UPDATE company_agents
    SET verification_models = array_replace(
          array_replace(
            array_replace(verification_models, 'gemini-3.1-pro-preview', 'gemini-3.1-flash-lite-preview'),
            'gemini-3-flash-preview', 'gemini-3.1-flash-lite-preview'
          ),
          'gemini-2.5-flash', 'gemini-3.1-flash-lite-preview'
        ),
        updated_at = NOW()
    WHERE verification_models IS NOT NULL
      AND (
        'gemini-3.1-pro-preview' = ANY(verification_models)
        OR 'gemini-3-flash-preview' = ANY(verification_models)
        OR 'gemini-2.5-flash' = ANY(verification_models)
      )
    RETURNING role, verification_models
  `);
  console.log(`\nUpdated verification_models for ${r3.rowCount} agents`);
  if (r3.rows.length > 0) console.table(r3.rows);

  // 5. Also update the default column if it references these models
  const r4 = await client.query(`
    ALTER TABLE company_agents ALTER COLUMN model SET DEFAULT 'model-router'
  `);
  console.log('\nSet default model column to model-router');

  // 6. Verify no agents remain on retired models
  const remaining = await client.query(`
    SELECT role, model FROM company_agents
    WHERE model IN ('gemini-3.1-pro-preview', 'gemini-3-flash-preview', 'gemini-2.5-flash')
  `);
  console.log(`\nRemaining agents on retired models: ${remaining.rows.length}`);
  if (remaining.rows.length > 0) console.table(remaining.rows);

  await client.end();
}
main().catch(console.error);
