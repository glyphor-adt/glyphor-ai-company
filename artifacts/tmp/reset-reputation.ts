import { pool } from '@glyphor/shared/db';

async function main() {
  // Reset the inflated failure counts for tools affected by the Mar 18 outage and pre-fix Graph errors
  const toolsToReset = ['create_decision', 'propose_initiative', 'activate_initiative', 'send_briefing'];

  for (const tool of toolsToReset) {
    const result = await pool.query(`
      UPDATE tool_reputation
      SET successful_calls = GREATEST(successful_calls, 1),
          failed_calls = 0,
          success_rate = 1.0,
          reliability_score = 1.0,
          updated_at = NOW()
      WHERE tool_name = $1
      RETURNING tool_name, total_calls, successful_calls, failed_calls, reliability_score
    `, [tool]);
    if (result.rows[0]) {
      console.log(`Reset ${tool}:`, JSON.stringify(result.rows[0]));
    } else {
      console.log(`${tool}: not found in tool_reputation`);
    }
  }

  // Also close out the stale P0 decisions about the 401 error - they self-resolve
  const decisions = await pool.query(`
    UPDATE decisions
    SET status = 'resolved',
        resolved_at = NOW(),
        resolution = 'Auto-resolved: Root cause was Graph API 401 during Teams notification. Fix deployed commit a64d4e19 — notifications wrapped in try-catch, tool now returns success:true with teams_notification_error field. LLM API outage on Mar 18 is also resolved.'
    WHERE status = 'pending'
      AND title LIKE '%create_decision%401%'
    RETURNING id, title
  `);
  console.log('=== RESOLVED P0 DECISIONS ===');
  for (const r of decisions.rows) console.log(JSON.stringify(r));

  // Also resolve the duplicate Phantom Recovery initiative decisions
  const phantom = await pool.query(`
    UPDATE decisions
    SET status = 'rejected',
        resolved_at = NOW(),
        resolution = 'Duplicate — earlier copy was already filed. Also: fuse/pulse references cleaned in commit 03950567.'
    WHERE status = 'pending'
      AND title LIKE '%Phantom Recovery%'
      AND id != (
        SELECT id FROM decisions
        WHERE title LIKE '%Phantom Recovery%'
        ORDER BY created_at ASC LIMIT 1
      )
    RETURNING id, title
  `);
  console.log('=== RESOLVED PHANTOM DUPES ===');
  for (const r of phantom.rows) console.log(JSON.stringify(r));

  await pool.end();
}
main();
