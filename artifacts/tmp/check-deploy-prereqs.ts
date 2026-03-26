import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  // 1. grant_tool_to_agent for platform-intel
  console.log('\n=== 1. grant_tool_to_agent for Nexus ===');
  const grant = await pool.query(
    `SELECT agent_role, tool_name, is_active, is_blocked, created_at
       FROM agent_tool_grants
      WHERE agent_role = 'platform-intel' AND tool_name = 'grant_tool_to_agent'`
  );
  console.table(grant.rows);

  // 2. Nexus schedules
  console.log('\n=== 2. Nexus schedules ===');
  const scheds = await pool.query(
    `SELECT agent_id, task, cron_expression, enabled, created_at
       FROM agent_schedules
      WHERE agent_id = 'platform-intel'
      ORDER BY task`
  );
  console.table(scheds.rows);

  // 3. create_specialist_agent grant for CMO
  console.log('\n=== 3. CMO create_specialist_agent grant ===');
  const cmoGrant = await pool.query(
    `SELECT agent_role, tool_name, is_active, is_blocked
       FROM agent_tool_grants
      WHERE agent_role = 'cmo' AND tool_name = 'create_specialist_agent'`
  );
  console.log(cmoGrant.rows.length ? 'EXISTS — needs deletion:' : 'Already removed (0 rows)');
  if (cmoGrant.rows.length) console.table(cmoGrant.rows);

  // 4. Pulse grants — check if any remain
  console.log('\n=== 4. Pulse grants remaining ===');
  const pulse = await pool.query(
    `SELECT COUNT(*)::int AS cnt
       FROM agent_tool_grants
      WHERE tool_name LIKE '%pulse%' OR tool_name LIKE '%Pulse%'`
  );
  console.log('Pulse grants remaining:', pulse.rows[0].cnt);

  // 5. gpt-5-mini-2025-08-07 hardcoded agents
  console.log('\n=== 5. Agents with gpt-5-mini-2025-08-07 ===');
  const gptMini = await pool.query(
    `SELECT role, model FROM company_agents WHERE model LIKE '%gpt-5-mini-2025-08-07%'`
  );
  console.log(gptMini.rows.length ? 'Found:' : 'None found (0 rows)');
  if (gptMini.rows.length) console.table(gptMini.rows);

  // 6. Sarah prompt — check for Nexus alias / escalation routing
  console.log('\n=== 6. Sarah prompt (latest deployed) ===');
  const sarah = await pool.query(
    `SELECT id, agent_id, LEFT(prompt_text, 500) AS prompt_preview, deployed_at
       FROM agent_prompt_versions
      WHERE agent_id = 'chief-of-staff'
        AND deployed_at IS NOT NULL
        AND retired_at IS NULL
      ORDER BY deployed_at DESC
      LIMIT 1`
  );
  if (sarah.rows.length) {
    console.log('Deployed at:', sarah.rows[0].deployed_at);
    const text = sarah.rows[0].prompt_preview;
    console.log('Contains "Nexus":', text.includes('Nexus'));
    console.log('Contains "platform-intel":', text.includes('platform-intel'));
    console.log('Contains "escalat":', text.toLowerCase().includes('escalat'));
    console.log('Preview:', text.substring(0, 300));
  } else {
    console.log('No deployed prompt found for chief-of-staff');
  }

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
