import { closePool, systemQuery } from '@glyphor/shared/db';

type ColumnRow = { column_name: string };

async function hasColumn(table: string, column: string): Promise<boolean> {
  const rows = await systemQuery<ColumnRow>(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    [table, column],
  );
  return rows.length > 0;
}

async function main(): Promise<void> {
  const grantsHasAgentId = await hasColumn('agent_tool_grants', 'agent_id');
  const grantsHasToolId = await hasColumn('agent_tool_grants', 'tool_id');

  const registryHasId = await hasColumn('tool_registry', 'id');
  const registryHasName = await hasColumn('tool_registry', 'name');
  const registryHasImplType = await hasColumn('tool_registry', 'implementation_type');
  const registryHasEndpoint = await hasColumn('tool_registry', 'endpoint');
  if (!registryHasName) {
    throw new Error('tool_registry.name column is required for this query but was not found.');
  }

  const idExpr = registryHasId ? 'tr.id' : 'tr.name';
  const implTypeExpr = registryHasImplType ? 'tr.implementation_type' : 'NULL';
  const endpointExpr = registryHasEndpoint ? 'COALESCE(tr.endpoint, \'\')' : '\'\'';

  const grantsSql = grantsHasAgentId && grantsHasToolId
    ? `SELECT ca.role, ca.name, tr.name AS tool_name, ${endpointExpr} AS endpoint
       FROM agent_tool_grants atg
       JOIN company_agents ca ON ca.id = atg.agent_id
       JOIN tool_registry tr ON tr.id = atg.tool_id
       WHERE ${endpointExpr} ILIKE '%pulse%'
          OR tr.name ILIKE '%pulse%'
          OR tr.name ILIKE '%storyboard%'
       ORDER BY ca.role, tr.name`
    : `SELECT ca.role, ca.name, atg.tool_name, ${endpointExpr} AS endpoint
       FROM agent_tool_grants atg
       JOIN company_agents ca ON ca.role = atg.agent_role
       LEFT JOIN tool_registry tr ON tr.name = atg.tool_name
       WHERE ${endpointExpr} ILIKE '%pulse%'
          OR atg.tool_name ILIKE '%pulse%'
          OR atg.tool_name ILIKE '%storyboard%'
       ORDER BY ca.role, atg.tool_name`;

    const registrySql = `SELECT ${idExpr} AS id, tr.name, ${implTypeExpr} AS implementation_type, ${endpointExpr} AS endpoint
                       FROM tool_registry tr
                       WHERE ${endpointExpr} ILIKE '%pulse%'
                          OR tr.name ILIKE '%storyboard%'
                          OR tr.name ILIKE '%pulse%'
                       ORDER BY tr.name`;

  const [grantsRows, registryRows] = await Promise.all([
    systemQuery(grantsSql, []),
    systemQuery(registrySql, []),
  ]);

  console.log(JSON.stringify({
    schema: {
      agent_tool_grants: {
        uses_agent_id_tool_id: grantsHasAgentId && grantsHasToolId,
      },
      tool_registry: {
        has_id: registryHasId,
        has_implementation_type: registryHasImplType,
        has_endpoint: registryHasEndpoint,
      },
    },
    pulseToolGrants: grantsRows,
    pulseToolsInRegistry: registryRows,
  }, null, 2));
}

main()
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[query-pulse-tool-grants] Failed: ${message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool().catch(() => undefined);
  });
