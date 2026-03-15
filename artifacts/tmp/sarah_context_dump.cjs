const { Client } = require('pg');

const client = new Client({
  host: '127.0.0.1',
  port: 5434,
  user: 'glyphor_app',
  password: 'lGHMxoC8zpmngKUaYv9cOTwJ',
  database: 'glyphor',
});

async function q(sql, params = []) {
  const res = await client.query(sql, params);
  return res.rows;
}

(async () => {
  await client.connect();

  const agent = await q(
    `SELECT role, display_name, title, department, reports_to, model, status, knowledge_access_scope
     FROM company_agents
     WHERE role = 'chief-of-staff'`
  );

  const brief = await q(
    `SELECT LENGTH(system_prompt) AS len, LEFT(system_prompt, 1200) AS preview
     FROM agent_briefs
     WHERE agent_id = 'chief-of-staff'`
  );

  const profile = await q(
    `SELECT personality_summary, backstory, communication_traits, quirks,
            tone_formality, emoji_usage, verbosity, working_voice
     FROM agent_profiles
     WHERE agent_id = 'chief-of-staff'`
  );

  const skills = await q(
    `SELECT s.slug, s.name, s.category, a.proficiency,
            LEFT(s.methodology, 400) AS methodology_preview
     FROM agent_skills a
     JOIN skills s ON s.id = a.skill_id
     WHERE a.agent_role = 'chief-of-staff'
     ORDER BY s.slug`
  );

  const mappings = await q(
    `SELECT task_regex, skill_slug, priority
     FROM task_skill_map
     WHERE skill_slug IN (
       SELECT s.slug
       FROM skills s
       JOIN agent_skills a ON a.skill_id = s.id
       WHERE a.agent_role = 'chief-of-staff'
     )
     ORDER BY priority DESC
     LIMIT 20`
  );

  const kb = await q(
    `SELECT section, title, audience, LEFT(content, 220) AS content_preview
     FROM company_knowledge_base
     WHERE is_active = true
       AND (audience = 'all' OR audience = 'operations')
     ORDER BY section
     LIMIT 20`
  );

  const bulletins = await q(
    `SELECT created_by, priority, LEFT(content, 220) AS content_preview, created_at, expires_at
     FROM founder_bulletins
     WHERE is_active = true
       AND (audience = 'all' OR audience = 'operations')
     ORDER BY priority ASC, created_at DESC
     LIMIT 10`
  );

  const pendingMessages = await q(
    `SELECT from_agent, message_type, priority, LEFT(message, 220) AS message_preview, created_at
     FROM agent_messages
     WHERE to_agent = 'chief-of-staff'
       AND status = 'pending'
     ORDER BY created_at ASC
     LIMIT 10`
  );

  console.log(
    JSON.stringify(
      {
        agent,
        brief,
        profile,
        skills,
        mappings,
        kb,
        bulletins,
        pending_messages: pendingMessages,
      },
      null,
      2
    )
  );

  await client.end();
})().catch(async (error) => {
  console.error('QUERY_ERROR:', error.message);
  try {
    await client.end();
  } catch {
    // ignore
  }
  process.exit(1);
});
