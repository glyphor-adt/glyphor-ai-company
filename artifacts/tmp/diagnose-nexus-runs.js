/**
 * diagnose-nexus-runs.js
 * Check recent Nexus runs to understand why it's not fixing things.
 */
import pg from 'pg';
const { Client } = pg;

async function main() {
  const c = new Client({
    host: '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '15432', 10),
    database: 'glyphor',
    user: 'glyphor_app',
    password: process.env.DB_PASSWORD,
  });
  await c.connect();

  // 1. Recent Nexus runs
  console.log('=== Recent Nexus runs (last 7 days) ===');
  const runs = await c.query(
    `SELECT id, task, status,
            turns, tool_calls, duration_ms,
            substring(error from 1 for 200) as error,
            started_at, completed_at
       FROM agent_runs
      WHERE agent_id = 'platform-intel'
        AND started_at > NOW() - INTERVAL '7 days'
      ORDER BY started_at DESC
      LIMIT 20`
  );
  for (const r of runs.rows) {
    console.log(`  [${r.status}] ${r.task} | ${r.turns} turns | ${r.tool_calls} tools | ${r.duration_ms}ms | ${r.started_at}`);
    if (r.error) console.log(`    ERROR: ${r.error}`);
  }

  // 2. Nexus tool usage in recent runs  
  console.log('\n=== Nexus tool usage (last 7 days) ===');
  const toolUsage = await c.query(
    `SELECT tc.tool_name, COUNT(*) as calls,
            COUNT(*) FILTER (WHERE tc.success = true) as successes,
            COUNT(*) FILTER (WHERE tc.success = false) as failures
       FROM tool_calls tc
      WHERE tc.agent_id = 'platform-intel'
        AND tc.created_at > NOW() - INTERVAL '7 days'
      GROUP BY tc.tool_name
      ORDER BY calls DESC
      LIMIT 30`
  );
  for (const r of toolUsage.rows) {
    const failRate = r.calls > 0 ? ((r.failures / r.calls) * 100).toFixed(0) : '0';
    console.log(`  ${r.tool_name}: ${r.calls} calls (${r.successes} ok / ${r.failures} fail = ${failRate}% fail)`);
  }

  // 3. Recent tool failures for Nexus
  console.log('\n=== Recent Nexus tool failures ===');
  const failures = await c.query(
    `SELECT tc.tool_name, substring(tc.error_message from 1 for 200) as error, tc.created_at
       FROM tool_calls tc
      WHERE tc.agent_id = 'platform-intel'
        AND tc.success = false
        AND tc.created_at > NOW() - INTERVAL '7 days'
      ORDER BY tc.created_at DESC
      LIMIT 15`
  );
  for (const r of failures.rows) {
    console.log(`  [${r.created_at}] ${r.tool_name}: ${r.error}`);
  }

  // 4. What autonomous actions did Nexus actually take?
  console.log('\n=== Nexus autonomous actions (last 7 days) ===');
  const actions = await c.query(
    `SELECT action_type, tier, target_agent_id, substring(description from 1 for 200) as desc, created_at
       FROM platform_intel_actions
      WHERE created_at > NOW() - INTERVAL '7 days'
      ORDER BY created_at DESC
      LIMIT 20`
  );
  for (const r of actions.rows) {
    console.log(`  [${r.tier}] ${r.action_type} → ${r.target_agent_id ?? 'fleet'}: ${r.desc}`);
  }

  // 5. Pending approval requests
  console.log('\n=== Pending Nexus approval requests ===');
  const pending = await c.query(
    `SELECT id, action_type, tier, target_agent_id, substring(description from 1 for 200) as desc, created_at
       FROM platform_intel_actions
      WHERE status = 'pending'
      ORDER BY created_at DESC
      LIMIT 10`
  );
  console.log(`  ${pending.rowCount} pending approvals`);
  for (const r of pending.rows) {
    console.log(`  [${r.tier}] ${r.action_type} → ${r.target_agent_id}: ${r.desc}`);
  }

  // 6. Check if Nexus tools are granted
  console.log('\n=== Nexus tool grants status ===');
  const grants = await c.query(
    `SELECT tool_name, is_active, is_blocked, last_synced_at
       FROM agent_tool_grants
      WHERE agent_role = 'platform-intel'
      ORDER BY tool_name`
  );
  const blocked = grants.rows.filter(r => r.is_blocked);
  const stale = grants.rows.filter(r => !r.last_synced_at);
  console.log(`  Total grants: ${grants.rowCount} | Blocked: ${blocked.length} | Stale (no sync): ${stale.length}`);
  if (blocked.length > 0) {
    console.log('  BLOCKED tools:');
    for (const r of blocked) console.log(`    ${r.tool_name}`);
  }

  await c.end();
}

main().catch(err => { console.error(err); process.exit(1); });
