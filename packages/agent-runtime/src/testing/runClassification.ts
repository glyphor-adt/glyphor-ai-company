import { systemQuery as dbQuery } from '@glyphor/shared/db';
import { getAllKnownTools } from '../toolRegistry.js';
import { autoClassifyTool } from './toolClassifier.js';

export async function classifyAllTools() {
  const tools = getAllKnownTools(); // returns string[] of tool names

  // Also get dynamic tools from DB
  const dynamicQuery = await dbQuery<{ name: string }>(
    `SELECT name FROM tool_registry WHERE is_active = true`
  );
  // Get MCP tools from db as well? Let's just do ones we can know.
  // We'll trust whatever is in KNOWN_TOOLS and dynamic for now.
  const dynamicTools = dynamicQuery;
  
  const allToolNames = [...new Set([
    ...tools,
    ...dynamicTools.map(t => t.name)
  ])];

  const classifications = allToolNames.map(name => {
    const isDynamic = dynamicTools.some(t => t.name === name);
    return autoClassifyTool(name, isDynamic ? 'dynamic' : 'static');
  });

  // Bulk upsert
  for (const c of classifications) {
    await dbQuery(`
      INSERT INTO tool_test_classifications
        (tool_name, risk_tier, test_strategy, source)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (tool_name) DO NOTHING
    `, [c.toolName, c.riskTier, c.testStrategy, c.source]);
  }

  console.log(`Classified ${classifications.length} tools`);
  console.log('Risk distribution:', classifications.reduce((acc, c) => {
    acc[c.riskTier] = (acc[c.riskTier] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>));
}

// Allow running standalone
if (require.main === module) {
  classifyAllTools().then(() => {
    console.log('Done.');
    process.exit(0);
  }).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
