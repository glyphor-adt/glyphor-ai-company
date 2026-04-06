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

  // Blocked tools for Nexus
  const blocked = await c.query(
    `SELECT tool_name, is_active, is_blocked, granted_by, reason
       FROM agent_tool_grants
      WHERE agent_role = 'platform-intel' AND is_blocked = true`
  );
  console.log('=== Nexus BLOCKED tools ===');
  for (const r of blocked.rows) {
    console.log(`  ${r.tool_name}: active=${r.is_active} blocked=${r.is_blocked} by=${r.granted_by} reason=${r.reason}`);
  }

  // Fix: unblock them
  const fix = await c.query(
    `UPDATE agent_tool_grants
        SET is_blocked = false, is_active = true, last_synced_at = NOW(), updated_at = NOW()
      WHERE agent_role = 'platform-intel' AND is_blocked = true
      RETURNING tool_name`
  );
  console.log(`\nUnblocked ${fix.rowCount} tools for Nexus:`, fix.rows.map(r => r.tool_name));

  await c.end();
}
main().catch(err => { console.error(err); process.exit(1); });
