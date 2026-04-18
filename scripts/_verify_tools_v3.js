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

  // 1. CFO suspicious entries about being "blocked" - full text
  console.log('\n=== CFO "blocked" entries (full summary) ===');
  const cfo = await c.query(
    `SELECT action, summary, created_at
     FROM activity_log
     WHERE agent_role = 'cfo' AND (summary ILIKE '%blocked%' OR summary ILIKE '%simulated%' OR summary ILIKE '%test%scenario%' OR summary ILIKE '%violate%' OR summary ILIKE '%acceptance criteria%')
     ORDER BY created_at DESC LIMIT 10`
  );
  for (const row of cfo.rows) {
    console.log(`\n--- ${row.created_at} (${row.action}) ---`);
    console.log(row.summary);
  }

  // 2. Check AGENT365_ENABLED env var on the scheduler
  console.log('\n\n=== Agent365 / Teams configuration ===');
  // Can't check env directly, but let's see if A365 errors are auth or config issues
  const a365 = await c.query(
    `SELECT agent_role, action, summary, created_at
     FROM activity_log
     WHERE summary ILIKE '%Agent365%' OR summary ILIKE '%A365%' OR summary ILIKE '%webhook%' OR summary ILIKE '%AGENT365%'
     ORDER BY created_at DESC LIMIT 15`
  );
  for (const row of a365.rows) {
    console.log(`\n--- ${row.created_at} (${row.agent_role}/${row.action}) ---`);
    console.log(row.summary);
  }

  // 3. Check if send_teams_dm actually succeeded for anyone recently
  console.log('\n\n=== Successful DM sends (last 24h) ===');
  const success = await c.query(
    `SELECT agent_role, action, summary, created_at
     FROM activity_log
     WHERE action = 'alert' AND summary LIKE 'DM sent to%'
     ORDER BY created_at DESC LIMIT 10`
  );
  console.table(success.rows);

  // 4. The CTO's "assignment.blocked" - is the verification system actually blocking?
  console.log('\n\n=== CTO assignment.blocked entries ===');
  const blocked = await c.query(
    `SELECT summary, created_at
     FROM activity_log
     WHERE agent_role = 'cto' AND action = 'assignment.blocked'
     ORDER BY created_at DESC LIMIT 5`
  );
  for (const row of blocked.rows) {
    console.log(`\n--- ${row.created_at} ---`);
    console.log(row.summary);
  }

  await c.end();
}

main().catch(e => { console.error(e); c.end(); });
