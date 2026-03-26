import { closePool, systemQuery } from '@glyphor/shared/db';

async function main(): Promise<void> {
  const rows = await systemQuery<{
    agent_role: string;
    tool_name: string;
    count: number;
  }>(
    `SELECT agent_role, tool_name, COUNT(*)::int as count
     FROM agent_tool_grants
     WHERE agent_role IN ('cmo', 'content-creator', 'social-media-manager')
     GROUP BY agent_role, tool_name
     ORDER BY agent_role, tool_name`,
    [],
  );

  console.log(JSON.stringify(rows, null, 2));
}

main()
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[query-agent-tool-grants-summary] Failed: ${message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool().catch(() => undefined);
  });
