const { Client } = require('pg');

(async () => {
  const c = new Client({
    host: '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '15432', 10),
    database: process.env.DB_NAME || 'glyphor',
    user: process.env.DB_USER || 'glyphor_app',
    password: process.env.DB_PASSWORD,
  });

  try {
    await c.connect();

    // Fix 1: Backfill last_synced_at on all active grants
    const r1 = await c.query(
      'UPDATE agent_tool_grants SET last_synced_at = NOW() WHERE last_synced_at IS NULL AND is_active = true RETURNING agent_role, tool_name'
    );
    console.log(`[Fix 1] Updated ${r1.rowCount} stale grants:`);
    for (const row of r1.rows) {
      console.log(`  ${row.agent_role} -> ${row.tool_name}`);
    }

    // Fix 2: Verify chief-of-staff delegate_directive is not blocked
    const r2 = await c.query(
      "SELECT tool_name, is_active, is_blocked, last_synced_at FROM agent_tool_grants WHERE agent_role = 'chief-of-staff' AND tool_name IN ('delegate_directive', 'create_work_assignments', 'web_fetch')"
    );
    console.log('\n[Check] chief-of-staff tool grants:');
    for (const row of r2.rows) {
      console.log(`  ${row.tool_name}: active=${row.is_active} blocked=${row.is_blocked} synced=${row.last_synced_at}`);
    }

    // Fix 3: Unblock any accidentally blocked tools
    const r3 = await c.query(
      "UPDATE agent_tool_grants SET is_blocked = false, updated_at = NOW() WHERE is_blocked = true AND tool_name IN ('delegate_directive', 'create_work_assignments', 'request_new_tool') RETURNING agent_role, tool_name"
    );
    if (r3.rowCount > 0) {
      console.log(`\n[Fix 3] Unblocked ${r3.rowCount} incorrectly blocked tools:`);
      for (const row of r3.rows) {
        console.log(`  ${row.agent_role} -> ${row.tool_name}`);
      }
    } else {
      console.log('\n[Fix 3] No incorrectly blocked tools found.');
    }

  } catch (e) {
    console.error('ERROR:', e.message);
  } finally {
    await c.end();
  }
})();
