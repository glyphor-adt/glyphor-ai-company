const { Client } = require('pg');

(async () => {
  const c = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });

  try {
    await c.connect();

    // 1. Inter-agent message volume last 7 days
    const vol = await c.query(`
      SELECT from_agent, to_agent, COUNT(*)::int as msg_count, MAX(created_at) as last_msg
      FROM agent_messages
      WHERE created_at > NOW() - interval '7 days'
      GROUP BY from_agent, to_agent
      ORDER BY msg_count DESC
      LIMIT 20
    `);
    console.log('=== INTER-AGENT MESSAGE VOLUME (7d) ===');
    console.log(JSON.stringify(vol.rows, null, 2));

    // 2. Total counts
    const totals = await c.query(`
      SELECT COUNT(*)::int as total_7d,
             COUNT(*) FILTER (WHERE created_at > NOW() - interval '24 hours')::int as total_24h,
             COUNT(*) FILTER (WHERE status = 'pending')::int as pending_unread
      FROM agent_messages
      WHERE created_at > NOW() - interval '7 days'
    `);
    console.log('\n=== TOTALS ===');
    console.log(JSON.stringify(totals.rows[0]));

    // 3. Recent Teams DM tool usage (send_teams_dm, send_dm) from actions JSONB
    const teamsDm = await c.query(`
      SELECT agent_role, COUNT(*)::int as dm_count
      FROM agent_runs ar,
           LATERAL jsonb_array_elements(
             CASE WHEN ar.actions IS NOT NULL AND jsonb_typeof(ar.actions) = 'array' THEN ar.actions ELSE '[]'::jsonb END
           ) AS action
      WHERE ar.created_at > NOW() - interval '7 days'
        AND action->>'tool' IN ('send_teams_dm', 'send_dm')
        AND ar.status = 'completed'
      GROUP BY agent_role
      ORDER BY dm_count DESC
      LIMIT 15
    `);
    console.log('\n=== TEAMS DM TOOL USAGE (7d) ===');
    console.log(JSON.stringify(teamsDm.rows, null, 2));

    // 4. Any <notify> blocks in completed runs?
    const notifyCount = await c.query(`
      SELECT COUNT(*)::int as count
      FROM agent_runs
      WHERE created_at > NOW() - interval '7 days'
        AND status = 'completed'
        AND output LIKE '%<notify%'
    `);
    console.log('\n=== RUNS WITH <notify> BLOCKS (7d) ===');
    console.log('Count:', notifyCount.rows[0].count);

    if (notifyCount.rows[0].count > 0) {
      const samples = await c.query(`
        SELECT agent_role, task, created_at,
               substring(output from '<notify[^>]*>') as notify_tag
        FROM agent_runs
        WHERE created_at > NOW() - interval '7 days'
          AND status = 'completed'
          AND output LIKE '%<notify%'
        ORDER BY created_at DESC
        LIMIT 5
      `);
      console.log(JSON.stringify(samples.rows, null, 2));
    }

    // 5. send_agent_message tool calls
    const samCount = await c.query(`
      SELECT agent_role, COUNT(*)::int as call_count
      FROM agent_runs ar,
           LATERAL jsonb_array_elements(
             CASE WHEN ar.actions IS NOT NULL AND jsonb_typeof(ar.actions) = 'array' THEN ar.actions ELSE '[]'::jsonb END
           ) AS action
      WHERE ar.created_at > NOW() - interval '7 days'
        AND action->>'tool' = 'send_agent_message'
        AND ar.status = 'completed'
      GROUP BY agent_role
      ORDER BY call_count DESC
      LIMIT 15
    `);
    console.log('\n=== send_agent_message TOOL USAGE (7d) ===');
    console.log(JSON.stringify(samCount.rows, null, 2));

    // 6. Sample recent messages
    const recent = await c.query(`
      SELECT from_agent, to_agent, message_type, priority, status,
             substring(message for 120) as snippet,
             created_at
      FROM agent_messages
      WHERE created_at > NOW() - interval '24 hours'
      ORDER BY created_at DESC
      LIMIT 10
    `);
    console.log('\n=== RECENT MESSAGES (24h) ===');
    console.log(JSON.stringify(recent.rows, null, 2));

  } catch (e) {
    console.error(e.message);
  } finally {
    try { await c.end(); } catch {}
  }
})();
