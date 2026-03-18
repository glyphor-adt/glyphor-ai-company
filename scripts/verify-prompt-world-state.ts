/**
 * Verify Self-Improvement + World State playbook deployment.
 * Run: npx tsx scripts/verify-prompt-world-state.ts
 */

import { createDbPool } from './lib/migrationLedger.js';

async function run() {
  const pool = createDbPool();
  const q = async (sql: string) => (await pool.query(sql)).rows;

  console.log('--- 1. Agents with versioned prompts (deployed) ---');
  console.log(await q(`SELECT COUNT(DISTINCT agent_id) AS count FROM agent_prompt_versions WHERE deployed_at IS NOT NULL`));

  console.log('\n--- 2. Reflection-sourced versions (should be 0 — no batch eval cycle yet) ---');
  console.log(await q(`SELECT COUNT(*) AS count FROM agent_prompt_versions WHERE source = 'reflection'`));

  console.log('\n--- 3. Shadow runs (should be empty — no shadow runs yet) ---');
  console.log(await q(`SELECT agent_id, challenger_prompt_version, COUNT(*) as run_count FROM shadow_runs GROUP BY agent_id, challenger_prompt_version`));

  console.log('\n--- 4. World state entries (should be empty — no agent runs yet) ---');
  console.log(await q(`SELECT domain, COUNT(*) as keys, MAX(updated_at) as last_write FROM world_state GROUP BY domain`));

  console.log('\n--- 5. Tables exist ---');
  console.log(await q(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('agent_prompt_versions','shadow_runs','world_state','world_state_history') ORDER BY tablename`));

  console.log('\n--- 6. Schema migrations applied ---');
  console.log(await q(`SELECT name, source FROM schema_migrations WHERE name LIKE '20260318%' ORDER BY name`));

  console.log('\n--- 7. Sample prompt versions (first 5) ---');
  console.log(await q(`SELECT agent_id, version, source, LENGTH(prompt_text) AS prompt_length, deployed_at IS NOT NULL AS is_deployed FROM agent_prompt_versions ORDER BY agent_id LIMIT 5`));

  console.log('\n--- 8. World state trigger exists ---');
  console.log(await q(`SELECT trigger_name, event_manipulation, action_timing FROM information_schema.triggers WHERE trigger_name = 'trg_world_state_history'`));

  await pool.end();
}

run().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
