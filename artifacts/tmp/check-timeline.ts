import { pool } from '@glyphor/shared/db';

async function main() {
  // When did the failures stop?
  const timeline = await pool.query(`
    SELECT date_trunc('hour', started_at) as hour, status, count(*) as cnt
    FROM agent_runs
    WHERE agent_id = 'chief-of-staff'
      AND started_at > NOW() - INTERVAL '2 days'
    GROUP BY 1, 2
    ORDER BY 1 DESC
  `);
  console.log('=== COS RUN TIMELINE ===');
  for (const r of timeline.rows) console.log(JSON.stringify(r));

  // Check how many agents were affected by model exhaustion
  const global = await pool.query(`
    SELECT agent_id, count(*) as fails
    FROM agent_runs
    WHERE error LIKE '%exhausted all models%'
      AND started_at > NOW() - INTERVAL '2 days'
    GROUP BY 1
    ORDER BY fails DESC LIMIT 15
  `);
  console.log('=== MODEL EXHAUSTION FAILURES (2d) ===');
  for (const r of global.rows) console.log(JSON.stringify(r));

  // Tool reputation for affected tools
  const rep = await pool.query(`
    SELECT tool_name, total_calls, successful_calls, failed_calls,
           ROUND(successful_calls::numeric / NULLIF(total_calls, 0) * 100, 1) as pct
    FROM tool_reputation
    WHERE tool_name IN ('create_decision', 'propose_initiative', 'activate_initiative',
                        'get_recent_activity', 'get_pending_decisions', 'get_financials', 'send_briefing')
    ORDER BY tool_name
  `);
  console.log('=== TOOL REPUTATION ===');
  for (const r of rep.rows) console.log(JSON.stringify(r));

  await pool.end();
}
main();
