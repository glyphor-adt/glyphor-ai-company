const { Client } = require('pg');
(async () => {
  const c = new Client({ host: '127.0.0.1', port: 6543, database: 'glyphor', user: 'glyphor_app', password: process.env.DB_PASSWORD });
  await c.connect();
  const q = async (l,s) => { try { const r = await c.query(s); console.log('\n==', l, '=='); console.table(r.rows); } catch(e) { console.log(l, 'ERR', e.message); } };

  // Latest state of the shadow-eval loop since today's deploy
  await q('shadow_evals last 24h', `
    SELECT id, agent_id, state, baseline_pass_rate, last_pass_rate, attempts_used, max_attempts,
           required_wins, consecutive_wins, promotion_margin, created_at, last_ran_at
    FROM cz_shadow_evals WHERE created_at > NOW()-INTERVAL '24 hours'
    ORDER BY created_at DESC`);

  // Did runs since latest deploy (08:00 UTC) actually use new models?
  await q('runs since 08:00 UTC pass rate', `
    SELECT DATE_TRUNC('hour', r.started_at) h, COUNT(*)::int n,
           COUNT(*) FILTER (WHERE s.passed)::int passed,
           ROUND((COUNT(*) FILTER (WHERE s.passed)::numeric/NULLIF(COUNT(*),0))*100,1) pct
    FROM cz_runs r JOIN cz_scores s ON s.run_id=r.id
    WHERE r.started_at > TIMESTAMP '2026-04-23 08:00:00+00'
    GROUP BY 1 ORDER BY 1 DESC`);

  // Did the ratchet cause any new reflections today?
  await q('reflection versions today', `
    SELECT agent_id, version, source, created_at,
           (SELECT state FROM cz_shadow_evals WHERE prompt_version_id=apv.id) eval_state
    FROM agent_prompt_versions apv
    WHERE created_at >= DATE '2026-04-23'
    ORDER BY created_at DESC`);

  // What proportion of heuristic failures would actually be prompt-addressable?
  await q('failure mode breakdown today', `
    WITH tags AS (
      SELECT
        CASE
          WHEN h LIKE 'topical_drift%' THEN 'topical_drift'
          WHEN h LIKE 'chat_intake_handshake%' THEN 'chat_intake_handshake'
          WHEN h LIKE 'verification_skipped%' THEN 'verification_skipped'
          WHEN h LIKE 'external_review_skipped%' THEN 'external_review_skipped'
          WHEN h LIKE 'infra_verification_skipped%' THEN 'infra_verification_skipped'
          WHEN h LIKE 'planning_not_execution%' THEN 'planning_not_execution'
          WHEN h LIKE 'agent_retired%' THEN 'agent_retired'
          ELSE 'other'
        END tag
      FROM cz_runs r JOIN cz_scores s ON s.run_id=r.id
      LEFT JOIN LATERAL UNNEST(COALESCE(s.heuristic_failures, ARRAY[]::text[])) AS h ON true
      WHERE r.started_at >= DATE '2026-04-23' AND s.passed=false
    )
    SELECT tag, COUNT(*)::int n FROM tags GROUP BY 1 ORDER BY 2 DESC`);

  // Rate limit status — how many agents are blocked from new reflections?
  await q('rate-limited agents (24h)', `
    SELECT agent_id, MAX(created_at) last_refl, NOW() - MAX(created_at) AS age
    FROM agent_prompt_versions
    WHERE source IN ('reflection','cz_reflection') AND created_at > NOW()-INTERVAL '24 hours'
    GROUP BY 1 ORDER BY 2 DESC`);

  // Does the CZ protocol actually pick up failing tasks for each agent?
  await q('latest failing tasks per agent (would be reflected on)', `
    SELECT t.responsible_agent, COUNT(*)::int failing_tasks,
           MIN(s.judge_score) min_score, MAX(s.judge_score) max_score
    FROM cz_runs r JOIN cz_scores s ON s.run_id=r.id JOIN cz_tasks t ON t.id=r.task_id
    WHERE r.started_at > NOW()-INTERVAL '6 hours' AND s.passed=false AND s.judge_tier != 'heuristic' AND s.agent_output IS NOT NULL AND s.agent_output != ''
    GROUP BY 1 ORDER BY 2 DESC`);

  // Are failed shadow_evals just letting the reflection version stay retired?
  await q('retired reflection versions today', `
    SELECT agent_id, version, source, created_at, retired_at
    FROM agent_prompt_versions
    WHERE source IN ('reflection','cz_reflection') AND retired_at IS NOT NULL AND retired_at > NOW()-INTERVAL '24 hours'
    ORDER BY retired_at DESC`);

  // Sample agent output that failed — did the new Claude model reach it?
  await q('sample failed run since 08:00', `
    SELECT r.id, t.responsible_agent, t.task, r.latency_ms,
           LEFT(COALESCE(s.agent_output,''), 220) judge_in,
           s.judge_score, s.heuristic_failures
    FROM cz_runs r JOIN cz_scores s ON s.run_id=r.id JOIN cz_tasks t ON t.id=r.task_id
    WHERE r.started_at > TIMESTAMP '2026-04-23 08:00:00+00' AND s.passed=false
    ORDER BY r.started_at DESC LIMIT 5`);

  await c.end();
})();
