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

  // 1. send_teams_dm failures
  console.log('\n=== send_teams_dm activity (last 48h) ===');
  const dm = await c.query(
    `SELECT agent_role, action, summary, tier, created_at
     FROM activity_log
     WHERE (action ILIKE '%teams_dm%' OR action ILIKE '%send_teams%' OR summary ILIKE '%teams_dm%' OR summary ILIKE '%teams dm%')
     ORDER BY created_at DESC LIMIT 15`
  );
  console.table(dm.rows);

  // 2. post_to_deliverables failures
  console.log('\n=== post_to_deliverables activity ===');
  const deliv = await c.query(
    `SELECT agent_role, action, summary, tier, created_at
     FROM activity_log
     WHERE (action ILIKE '%deliverables%' OR summary ILIKE '%deliverables%')
     ORDER BY created_at DESC LIMIT 15`
  );
  console.table(deliv.rows);

  // 3. Pending decisions (yellow)
  console.log('\n=== decisions table columns ===');
  const dcols = await c.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'decisions' ORDER BY ordinal_position`
  );
  console.log(dcols.rows.map(r => r.column_name).join(', '));

  console.log('\n=== Pending decisions ===');
  const dec = await c.query(
    `SELECT * FROM decisions WHERE status = 'pending' ORDER BY created_at DESC LIMIT 10`
  );
  console.table(dec.rows);

  // 4. constitutional_gate_events columns + recent
  console.log('\n=== constitutional_gate_events columns ===');
  const gcols = await c.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'constitutional_gate_events' ORDER BY ordinal_position`
  );
  console.log(gcols.rows.map(r => r.column_name).join(', '));

  console.log('\n=== Recent gate events ===');
  const gates = await c.query(
    `SELECT * FROM constitutional_gate_events ORDER BY created_at DESC LIMIT 10`
  );
  console.table(gates.rows);

  // 5. CTO recent activity
  console.log('\n=== CTO recent activity ===');
  const cto = await c.query(
    `SELECT action, summary, tier, created_at
     FROM activity_log
     WHERE agent_role = 'cto'
     ORDER BY created_at DESC LIMIT 10`
  );
  console.table(cto.rows);

  // 6. Nexus / platform-intel
  console.log('\n=== Nexus / vp-research agent status ===');
  const nexus = await c.query(
    `SELECT role, status, display_name, updated_at
     FROM company_agents
     WHERE role IN ('nexus', 'platform-intel', 'vp-research')`
  );
  console.table(nexus.rows);

  // 7. query_database, query_provider_metrics, gcp_iam_list_members in any pending/yellow context
  console.log('\n=== Tool grant / authority for claimed yellow tools ===');
  const tools = await c.query(
    `SELECT agent_role, action, summary, tier, created_at
     FROM activity_log
     WHERE action ILIKE '%query_database%' OR action ILIKE '%query_provider%' OR action ILIKE '%gcp_iam%'
        OR summary ILIKE '%query_database%' OR summary ILIKE '%query_provider%' OR summary ILIKE '%gcp_iam%'
     ORDER BY created_at DESC LIMIT 15`
  );
  console.table(tools.rows);

  // 8. authority_proposals
  console.log('\n=== authority_proposals columns ===');
  const apcols = await c.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'authority_proposals' ORDER BY ordinal_position`
  );
  console.log(apcols.rows.map(r => r.column_name).join(', '));

  console.log('\n=== Recent authority_proposals ===');
  const ap = await c.query(
    `SELECT * FROM authority_proposals ORDER BY created_at DESC LIMIT 10`
  );
  console.table(ap.rows);

  // 9. Weekly review runs mentioned
  console.log('\n=== Recent weekly_review runs ===');
  const wr = await c.query(
    `SELECT agent_role, action, summary, tier, created_at
     FROM activity_log
     WHERE action ILIKE '%weekly_review%' OR summary ILIKE '%weekly_review%' OR action ILIKE '%weekly%review%'
     ORDER BY created_at DESC LIMIT 10`
  );
  console.table(wr.rows);

  // 10. Verification system blocks
  console.log('\n=== Verification system blocks ===');
  const verif = await c.query(
    `SELECT agent_role, action, summary, tier, created_at
     FROM activity_log
     WHERE summary ILIKE '%verification%' OR summary ILIKE '%blocked%' OR action ILIKE '%verif%'
     ORDER BY created_at DESC LIMIT 15`
  );
  console.table(verif.rows);

  await c.end();
}

main().catch(e => { console.error(e); c.end(); });
