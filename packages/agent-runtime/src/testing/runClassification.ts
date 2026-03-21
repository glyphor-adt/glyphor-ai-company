import { pathToFileURL } from 'node:url';
import { systemQuery as dbQuery } from '@glyphor/shared/db';
import { getAllKnownTools } from '../toolRegistry.js';
import { classifyTool, type ToolClassification } from './toolClassifier.js';

export async function classifyAllTools() {
  const tools = getAllKnownTools();
  const dynamicTools = await dbQuery<{ name: string }>(
    'SELECT name FROM tool_registry WHERE is_active = true',
  );

  const allToolNames = [...new Set([
    ...tools,
    ...dynamicTools.map((t) => t.name),
  ])];

  const classifications: ToolClassification[] = allToolNames.map((name) => {
    const isDynamic = dynamicTools.some((t) => t.name === name);
    const base = classifyTool(name);
    return {
      ...base,
      source: isDynamic ? 'dynamic' : base.source,
    };
  });

  for (const c of classifications) {
    await dbQuery(
      `
        INSERT INTO tool_test_classifications
          (tool_name, risk_tier, test_strategy, source)
        VALUES
          ($1, $2, $3, $4)
        ON CONFLICT (tool_name) DO NOTHING
      `,
      [c.toolName, c.riskTier, c.testStrategy, c.source],
    );
  }

  console.log(`Classified ${classifications.length} tools.`);
  console.log(
    'Risk distribution:',
    classifications.reduce((acc, c) => {
      acc[c.riskTier] = (acc[c.riskTier] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>),
  );

  return classifications;
}

const isEntrypoint = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isEntrypoint) {
  classifyAllTools()
    .then(() => {
      console.log('Done.');
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
