export type ToolRiskTier =
  | 'read_only'        // No side effects — safe to call in any env
  | 'idempotent_write' // Writes but safe to repeat (upserts, status updates)
  | 'destructive'      // Deletes, sends messages, charges money, emails
  | 'external_api'     // Calls third-party services (Slack, Teams, OpenAI, etc.)
  | 'infrastructure'   // Touches Cloud Run, DB schema, secrets
  | 'unknown';         // Not yet classified

export type TestStrategy =
  | 'live'             // Call it directly — safe
  | 'probe'            // Call a read/health endpoint of the same service
  | 'mock'             // Call with mock dependencies
  | 'sandbox'          // Call in isolated test environment
  | 'schema_only';     // Validate definition only — do not call

export interface ToolClassification {
  toolName: string;
  riskTier: ToolRiskTier;
  testStrategy: TestStrategy;
  testInput?: Record<string, unknown>;  // safe test params if known
  skipReason?: string;                  // why this tool is schema_only
  source: 'static' | 'dynamic' | 'mcp';
}

const READ_ONLY_PATTERNS = [
  /^get_/, /^list_/, /^read_/, /^query_/, /^check_/, /^fetch_/,
  /^inspect_/, /^search_/, /^find_/, /^show_/, /^describe_/,
  /health$/, /status$/, /metrics$/, /stats$/, /info$/
];

const DESTRUCTIVE_PATTERNS = [
  /^send_/, /^post_/, /^delete_/, /^remove_/, /^purge_/,
  /^email/, /^notify_/, /^publish_/, /^deploy_/, /^rollback_/,
  /^charge_/, /^invoice_/, /^pay_/, /^create_github_pr/,
  /^merge_/, /^update_cloud_run_secrets/, /^create_incident/,
  /^create_/, /^update_/, /^write_/, /^insert_/
];

const EXTERNAL_API_PATTERNS = [
  /slack/, /teams/, /github/, /stripe/, /mercury/, /openai/,
  /anthropic/, /gemini/, /figma/, /canva/, /vercel/, /linear/,
  /notion/, /hubspot/, /salesforce/, /mcp_/
];

const INFRASTRUCTURE_PATTERNS = [
  /cloud_run/, /cloud_build/, /cloud_sql/, /secret_manager/,
  /deploy/, /rollback/, /scale_/, /migrate/, /schema/
];

export function autoClassifyTool(toolName: string, source: 'static'|'dynamic'|'mcp' = 'static'): ToolClassification {
  const isReadOnly = READ_ONLY_PATTERNS.some(p => p.test(toolName));
  const isDestructive = DESTRUCTIVE_PATTERNS.some(p => p.test(toolName));
  const isExternalApi = EXTERNAL_API_PATTERNS.some(p => p.test(toolName));
  const isInfrastructure = INFRASTRUCTURE_PATTERNS.some(p => p.test(toolName));

  if (isDestructive || isInfrastructure) {
    return {
      toolName, source,
      riskTier: isInfrastructure ? 'infrastructure' : 'destructive',
      testStrategy: 'sandbox',
    };
  }
  if (isExternalApi) {
    return {
      toolName, source,
      riskTier: 'external_api',
      testStrategy: 'probe',  // probe the service health, don't call the tool
    };
  }
  if (isReadOnly) {
    return {
      toolName, source,
      riskTier: 'read_only',
      testStrategy: 'live',
    };
  }
  return {
    toolName, source,
    riskTier: 'unknown',
    testStrategy: 'schema_only',
  };
}
