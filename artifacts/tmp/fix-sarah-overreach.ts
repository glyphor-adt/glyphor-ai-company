import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  // 1. Remove grant/revoke tools from Sarah
  const del = await pool.query(
    `DELETE FROM agent_tool_grants
      WHERE agent_role = 'chief-of-staff'
        AND tool_name IN ('grant_tool_access', 'revoke_tool_access', 'grant_tool_to_agent')
      RETURNING tool_name`
  );
  console.log(`Removed ${del.rowCount} tool grants from chief-of-staff:`);
  for (const row of del.rows) console.log(`  - ${row.tool_name}`);

  // 2. Update Sarah's prompt — inject routing constraint after Authority section
  const { rows } = await pool.query(
    `SELECT id, prompt_text
       FROM agent_prompt_versions
      WHERE agent_id = 'chief-of-staff'
        AND deployed_at IS NOT NULL
        AND retired_at IS NULL
      ORDER BY deployed_at DESC
      LIMIT 1`
  );

  if (!rows.length) {
    throw new Error('No deployed prompt found for chief-of-staff');
  }

  const promptId = rows[0].id;
  const oldPrompt = rows[0].prompt_text as string;

  // Find the Authority section end and inject after it
  const authorityEnd = 'YELLOW/RED: Route only — cannot approve.';
  const idx = oldPrompt.indexOf(authorityEnd);
  if (idx === -1) throw new Error('Could not find Authority section marker');

  const insertPoint = idx + authorityEnd.length;

  const constraint = `

## Tool Access — Non-Negotiable Rule

You do not grant or revoke tool access directly.
When a tool gap is identified, dispatch to Nexus (platform-intel).
Do not use grant_tool_access or revoke_tool_access under any circumstances.
Do not take actions beyond what was requested.`;

  // Check if already present
  if (oldPrompt.includes('You do not grant or revoke tool access directly')) {
    console.log('\nConstraint already present in prompt — skipping.');
  } else {
    const newPrompt = oldPrompt.slice(0, insertPoint) + constraint + oldPrompt.slice(insertPoint);

    await pool.query(
      `UPDATE agent_prompt_versions SET prompt_text = $1 WHERE id = $2`,
      [newPrompt, promptId]
    );
    console.log('\nInjected tool access constraint after Authority section');
    console.log('Old length:', oldPrompt.length, '→ New length:', newPrompt.length);
  }

  // Verify grants are gone
  const check = await pool.query(
    `SELECT tool_name FROM agent_tool_grants
      WHERE agent_role = 'chief-of-staff'
        AND tool_name IN ('grant_tool_access', 'revoke_tool_access', 'grant_tool_to_agent')`
  );
  console.log('\nRemaining grant/revoke tools for Sarah:', check.rows.length);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
