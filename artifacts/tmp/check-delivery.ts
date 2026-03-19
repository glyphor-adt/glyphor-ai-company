import { pool } from '@glyphor/shared/db';

async function main() {
  // Check recent agent run outputs for send_briefing success details
  const briefings = await pool.query(`
    SELECT id, agent_id, task, status, result_summary, started_at
    FROM agent_runs
    WHERE agent_id = 'chief-of-staff'
      AND task = 'generate_briefing'
    ORDER BY started_at DESC
    LIMIT 5
  `);
  console.log('=== RECENT BRIEFING RUNS ===');
  for (const r of briefings.rows) {
    console.log(JSON.stringify({ id: r.id, status: r.status, summary: r.result_summary?.substring(0, 200), started_at: r.started_at }));
  }

  // Check recent activity log for briefing delivery mode
  const activity = await pool.query(`
    SELECT agent_role, action, summary, created_at
    FROM activity_log
    WHERE action = 'briefing'
    ORDER BY created_at DESC
    LIMIT 10
  `);
  console.log('=== BRIEFING ACTIVITY LOG ===');
  for (const r of activity.rows) console.log(JSON.stringify(r));

  // Check recent decisions that were actually sent to Teams
  const decisions = await pool.query(`
    SELECT id, tier, title, proposed_by, created_at
    FROM decisions
    WHERE created_at > NOW() - INTERVAL '6 hours'
    ORDER BY created_at DESC
  `);
  console.log('=== DECISIONS LAST 6H ===');
  for (const r of decisions.rows) console.log(JSON.stringify(r));

  await pool.end();
}
main();
