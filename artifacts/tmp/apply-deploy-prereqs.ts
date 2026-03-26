import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── 1. Pulse grant cleanup ──
    console.log('\n=== 1. Pulse grant cleanup ===');
    const pulseResult = await client.query(
      `DELETE FROM agent_tool_grants
        WHERE tool_name LIKE 'pulse_%'
          AND agent_role IN ('cmo', 'content-creator', 'social-media-manager')
        RETURNING agent_role, tool_name`
    );
    console.log(`Deleted ${pulseResult.rowCount} Pulse grants`);

    // Verify none remain for those 3 agents
    const remaining = await client.query(
      `SELECT COUNT(*)::int AS cnt FROM agent_tool_grants
        WHERE tool_name LIKE 'pulse_%'
          AND agent_role IN ('cmo', 'content-creator', 'social-media-manager')`
    );
    console.log('Remaining Pulse grants for those agents:', remaining.rows[0].cnt);

    // ── 2. gpt-5-mini-2025-08-07 → model-router ──
    console.log('\n=== 2. gpt-5-mini-2025-08-07 → model-router ===');
    const modelResult = await client.query(
      `UPDATE company_agents
          SET model = 'model-router',
              updated_at = NOW()
        WHERE model = 'gpt-5-mini-2025-08-07'
        RETURNING role`
    );
    console.log(`Updated ${modelResult.rowCount} agents:`);
    for (const row of modelResult.rows) {
      console.log(`  - ${row.role}`);
    }

    // Verify
    const gptCheck = await client.query(
      `SELECT COUNT(*)::int AS cnt FROM company_agents WHERE model = 'gpt-5-mini-2025-08-07'`
    );
    console.log('Remaining gpt-5-mini-2025-08-07 agents:', gptCheck.rows[0].cnt);

    // ── 3. Sarah prompt — replace tail section with full Nexus block ──
    console.log('\n=== 3. Sarah prompt — update Nexus section ===');

    const { rows: promptRows } = await client.query(
      `SELECT id, prompt_text
         FROM agent_prompt_versions
        WHERE agent_id = 'chief-of-staff'
          AND deployed_at IS NOT NULL
          AND retired_at IS NULL
        ORDER BY deployed_at DESC
        LIMIT 1`
    );

    if (!promptRows.length) {
      throw new Error('No deployed prompt found for chief-of-staff');
    }

    const oldPrompt = promptRows[0].prompt_text as string;
    const promptId = promptRows[0].id;

    // Find the existing Nexus block at the end and replace it
    const nexusMarker = '\nNexus (role: platform-intel';
    const markerIdx = oldPrompt.indexOf(nexusMarker);

    if (markerIdx === -1) {
      throw new Error('Could not find existing Nexus section in Sarah prompt');
    }

    const beforeNexus = oldPrompt.substring(0, markerIdx);

    const newNexusBlock = `
## Agent Directory

Nexus (role: platform-intel, department: Operations) is the platform 
intelligence agent. It watches fleet health and resolves infrastructure 
issues autonomously.

## Escalation Routing Rules

Apply these before surfacing anything to founders:

- Tool does not exist in tool_registry → dispatch to Nexus (platform-intel) 
  to build and grant it. Notify founders of action taken, do not ask for approval.
- Tool exists but agent lacks grant → surface to founders for approval.
- Any agent requests creation of a new agent → auto-reject immediately. 
  Do not surface to founders. Write negative evidence to world model.
- Restricted tool request where tool is a confirmed gap → route to Nexus, 
  auto-reject the founder approval request.
- Founder rejection of any downstream output → write negative evidence to 
  world model of the responsible agent. Do not re-surface the same request.`;

    const newPrompt = beforeNexus + newNexusBlock;

    await client.query(
      `UPDATE agent_prompt_versions
          SET prompt_text = $1
        WHERE id = $2`,
      [newPrompt, promptId]
    );
    console.log('Updated prompt ID:', promptId);
    console.log('Old length:', oldPrompt.length, '→ New length:', newPrompt.length);

    // Show the tail of the new prompt for verification
    console.log('\n--- New prompt tail (last 600 chars) ---');
    console.log(newPrompt.slice(-600));

    await client.query('COMMIT');
    console.log('\n✅ All 3 changes committed.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ ROLLED BACK:', (err as Error).message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
