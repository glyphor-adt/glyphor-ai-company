import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  // Get Sarah's full prompt text
  const { rows } = await pool.query(
    `SELECT id, agent_id, prompt_text, deployed_at
       FROM agent_prompt_versions
      WHERE agent_id = 'chief-of-staff'
        AND deployed_at IS NOT NULL
        AND retired_at IS NULL
      ORDER BY deployed_at DESC
      LIMIT 1`
  );
  if (rows.length) {
    console.log('Prompt ID:', rows[0].id);
    console.log('Deployed at:', rows[0].deployed_at);
    console.log('--- FULL PROMPT TEXT ---');
    console.log(rows[0].prompt_text);
    console.log('--- END ---');
  } else {
    console.log('No deployed prompt found');
  }

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
