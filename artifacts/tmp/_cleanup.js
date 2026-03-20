const { Client } = require('pg');

(async () => {
  const c = new Client({
    host: process.env.DB_HOST,
    port: +process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });
  await c.connect();

  // 1. Reject stale cascade decisions
  console.log('=== REJECTING STALE CASCADE DECISIONS ===');
  const staleDecisionIds = [
    '2e8b1a22-5e6b-4b93-8ca7-4021a1290b07', // New specialist: Social Media Publisher (redundant)
    '75fb977f-a5bc-4117-b8fe-45c6e0c3f592', // CMO: Strategy (social-media-manager paused loop)
    '98aa3122-f564-4af0-9964-a0727b25d322', // CTO: Technical Investigation (create_specialist_agent)
    '7e1ee5fc-aded-4898-8efb-446a39d74f36', // Restricted tool: gcp_create_secret (stripe exists as stripe-secret-key)
    '30819d91-c405-4487-992d-1ecd36bddd96', // Approve initiative: Re-activate Social Media Manager
    '2ad77bf3-8d49-4004-a6fe-13938c4592cf', // New specialist: Temporary Social Media Manager
  ];

  for (const id of staleDecisionIds) {
    const r = await c.query(
      `UPDATE decisions SET status = 'rejected', resolved_by = 'founder', 
       resolution_note = 'Bulk rejected: cascade loop from cross-model verification false positives. Root cause fixed.'
       WHERE id = $1 AND status = 'pending' RETURNING title`,
      [id]
    );
    if (r.rows.length) {
      console.log(`  REJECTED: ${r.rows[0].title}`);
    } else {
      console.log(`  SKIPPED (not pending): ${id}`);
    }
  }

  // 2. Retire redundant temp specialists (keep only the original social-media-manager)
  console.log('\n=== RETIRING REDUNDANT TEMP SPECIALISTS ===');
  const tempRoles = [
    'social-media-publisher',           // CMO created, redundant
    'temporary-social-media-manager',   // CMO created, redundant
    'social-media-specialist',          // CTO created, redundant
  ];

  for (const role of tempRoles) {
    const r = await c.query(
      `UPDATE company_agents SET status = 'retired', updated_at = now()
       WHERE role = $1 AND status = 'active' AND is_temporary = true
       RETURNING role, display_name`,
      [role]
    );
    if (r.rows.length) {
      console.log(`  RETIRED: ${r.rows[0].role} (${r.rows[0].display_name})`);
    } else {
      console.log(`  SKIPPED (not active): ${role}`);
    }
  }

  // 3. Grant list_secrets to platform-engineer so they can check before requesting
  console.log('\n=== GRANTING list_secrets TO PLATFORM-ENGINEER ===');
  const grantResult = await c.query(`
    INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by, reason, is_active, is_blocked, created_at, updated_at)
    VALUES ('platform-engineer', 'list_secrets', 'founder', 'Prevent duplicate secret creation requests - PE must check before creating', true, false, now(), now())
    ON CONFLICT DO NOTHING
    RETURNING tool_name
  `);
  if (grantResult.rows.length) {
    console.log('  GRANTED: list_secrets');
  } else {
    console.log('  ALREADY EXISTS');
  }

  // 4. Verify remaining state
  console.log('\n=== REMAINING PENDING DECISIONS ===');
  const remaining = await c.query(`
    SELECT id, title, tier, proposed_by, created_at 
    FROM decisions WHERE status = 'pending' 
    ORDER BY created_at DESC
  `);
  console.log(JSON.stringify(remaining.rows, null, 2));

  console.log('\n=== ACTIVE TEMP AGENTS ===');
  const temps = await c.query(`
    SELECT role, display_name, status, created_by, expires_at
    FROM company_agents WHERE is_temporary = true AND status = 'active'
    ORDER BY created_at DESC
  `);
  console.log(JSON.stringify(temps.rows, null, 2));

  await c.end();
  console.log('\nDone.');
})().catch(e => { console.error(e.message); process.exit(1); });
