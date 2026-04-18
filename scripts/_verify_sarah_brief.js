const pg = require('pg');
const c = new pg.Client({
  host: '127.0.0.1',
  port: 6543,
  database: 'glyphor',
  user: 'glyphor_app',
  password: 'TempAuth2026x'
});

async function main() {
  await c.connect();

  // 1. Check send_teams_dm failures in activity_log
  console.log('\n=== send_teams_dm failures (last 48h) ===');
  const dm = await c.query(
    `SELECT agent_role, action, status, error_message, created_at
     FROM activity_log
     WHERE action ILIKE '%teams_dm%' OR action ILIKE '%send_teams%'
     ORDER BY created_at DESC LIMIT 10`
  );
  console.table(dm.rows);

  // 2. Check post_to_deliverables failures
  console.log('\n=== post_to_deliverables failures (last 48h) ===');
  const deliv = await c.query(
    `SELECT agent_role, action, status, error_message, created_at
     FROM activity_log
     WHERE action ILIKE '%deliverables%'
     ORDER BY created_at DESC LIMIT 10`
  );
  console.table(deliv.rows);

  // 3. Check pending yellow decisions
  console.log('\n=== Pending yellow decisions ===');
  const yellow = await c.query(
    `SELECT id, agent_role, tool_name, status, created_at
     FROM authority_decisions
     WHERE status = 'pending' AND color = 'yellow'
     ORDER BY created_at DESC LIMIT 10`
  );
  if (yellow.rows.length === 0) {
    // try alternate table/column names
    console.log('(no rows from authority_decisions with color=yellow)');
  } else {
    console.table(yellow.rows);
  }

  // 4. Check CTO recent activity
  console.log('\n=== CTO recent activity ===');
  const cto = await c.query(
    `SELECT action, status, error_message, created_at
     FROM activity_log
     WHERE agent_role = 'cto'
     ORDER BY created_at DESC LIMIT 10`
  );
  console.table(cto.rows);

  // 5. Check Nexus / platform-intel status
  console.log('\n=== Nexus / platform-intel agent status ===');
  const nexus = await c.query(
    `SELECT role, status, display_name, updated_at
     FROM company_agents
     WHERE role IN ('nexus', 'platform-intel', 'vp-research')
     ORDER BY role`
  );
  console.table(nexus.rows);

  // 6. Check chief-of-staff recent activity
  console.log('\n=== Chief-of-staff (Sarah) recent briefs ===');
  const sarah = await c.query(
    `SELECT action, status, error_message, created_at
     FROM activity_log
     WHERE agent_role = 'chief-of-staff'
     ORDER BY created_at DESC LIMIT 10`
  );
  console.table(sarah.rows);

  await c.end();
}

main().catch(e => { console.error(e); c.end(); });
