import { systemQuery } from '@glyphor/shared/db';

async function main() {
  // Get a sample active agent for reference
  const r = await systemQuery(`
    SELECT role, display_name, model, status, department, name, title, reports_to,
           is_core, temperature, max_turns, team, thinking_enabled
    FROM company_agents
    WHERE role = 'content-creator'
  `);
  console.log('Sample (content-creator):', JSON.stringify(r[0], null, 2));

  // Also check what model the current active agents use
  const models = await systemQuery(`
    SELECT DISTINCT model, COUNT(*) as cnt
    FROM company_agents
    WHERE status = 'active'
    GROUP BY model
  `);
  console.log('\nActive agent models:', models);
  process.exit(0);
}
main();
