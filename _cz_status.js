const { Client } = require('pg');
(async () => {
    const c = new Client({ host: '127.0.0.1', port: 6543, database: 'glyphor', user: 'glyphor_app', password: process.env.DB_PASSWORD });
    await c.connect();
    const Q = async (title, sql) => { try { const r = await c.query(sql); console.log(`\n=== ${title} (${r.rowCount}) ===`); for (const row of r.rows) console.log(JSON.stringify(row)); } catch (e) { console.log(`\n=== ${title} === ERR ${e.message}`); } };

    await Q('cz_runs recent', `SELECT batch_id, mode, trigger_type, status, started_at, completed_at FROM cz_runs ORDER BY started_at DESC NULLS LAST LIMIT 10`);
    await Q('cz_runs 24h', `SELECT date_trunc('hour', started_at) as hr, count(*), count(*) filter (where status='completed') as ok, count(*) filter (where status='failed') as fail FROM cz_runs WHERE started_at > now()-interval '24 hours' GROUP BY 1 ORDER BY 1 DESC`);
    await Q('cz_scores 24h', `SELECT count(*) as total, count(*) filter (where passed) as passed, round(avg(judge_score)::numeric,1) as avg_score FROM cz_scores WHERE created_at > now()-interval '24 hours'`);
    await Q('cz_scores per-agent 24h', `SELECT COALESCE(t.responsible_agent,'?') as agent, count(*) as n, count(*) filter (where s.passed) as passed, round(avg(s.judge_score)::numeric,1) as avg_score FROM cz_scores s JOIN cz_runs r ON r.id=s.run_id JOIN cz_tasks t ON t.id=r.task_id WHERE s.created_at > now()-interval '24 hours' GROUP BY 1 ORDER BY n DESC`);
    await Q('Prompt versions per agent', `SELECT agent_id, count(*) as versions, max(version) as latest, max(deployed_at) as last_deploy FROM agent_prompt_versions GROUP BY agent_id ORDER BY versions DESC LIMIT 15`);
    await Q('Active prompt (retired_at IS NULL) per agent', `SELECT DISTINCT ON (agent_id) agent_id, version, source, deployed_at FROM agent_prompt_versions WHERE retired_at IS NULL ORDER BY agent_id, version DESC LIMIT 30`);
    await Q('Reflection mutations: staged vs deployed', `SELECT source, count(*) as total, count(*) filter (where deployed_at IS NOT NULL) as deployed, count(*) filter (where retired_at IS NULL AND deployed_at IS NOT NULL) as active FROM agent_prompt_versions WHERE source IN ('reflection','cz_reflection') GROUP BY source`);
    await Q('Shadow evals', `SELECT state, count(*) FROM cz_shadow_evals GROUP BY 1`);
    await Q('cz_automation_config', `SELECT key, value_json::text FROM cz_automation_config`);
    await c.end();
})();
