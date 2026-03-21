import { systemQuery as dbQuery } from '@glyphor/shared/db';

export interface ToolTestResult {
  toolName: string;
  riskTier: string;
  testStrategy: string;
  testRunId: string;
  status: 'pass' | 'fail' | 'skip' | 'error' | 'timeout';
  responseMs?: number | null;
  errorMessage?: string | null;
  errorType?: string | null;
  schemaValid?: boolean | null;
  connectivityOk?: boolean | null;
  executionOk?: boolean | null;
  rawResponse?: any | null;
  testedAt?: Date | string;
}

export async function handleToolTestFailure(
  result: ToolTestResult
): Promise<void> {

  // Determine severity based on risk tier and error type
  const severity = getFailureSeverity(result);

  // Write fleet finding
  const findingResp = await dbQuery(`
    INSERT INTO fleet_findings
      (agent_id, severity, finding_type, description, score_penalty)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (agent_id, finding_type)
      DO UPDATE SET
        description = EXCLUDED.description,
        detected_at = NOW(),
        resolved_at = NULL
    RETURNING id
  `, [
    'tool-registry',       // not an agent — tool registry is the owner
    severity,
    `tool_health_failure:${result.toolName}`,
    buildFindingDescription(result),
    severity === 'P0' ? 0.15 : severity === 'P1' ? 0.05 : 0,
  ]);

  const finding = findingResp[0];

  // Write to tool_reputation table — affects ToolRetriever scoring
  // Try to update it safely - ignore if it doesn't exist. Let's make sure the table exists, but we can do an insert if it doesn't? Let's just update.
  await dbQuery(`
    UPDATE tool_reputation
    SET
      last_test_status = $2,
      last_test_at = NOW(),
      last_test_error = $3,
      health_score = CASE
        WHEN $2 = 'fail' THEN GREATEST(0, health_score - 0.2)
        WHEN $2 = 'pass' THEN LEAST(1.0, health_score + 0.1)
        ELSE health_score
      END
    WHERE tool_slug = $1
  `, [result.toolName, result.status, result.errorMessage]).catch(() => {
    // some systems use tool_name, some tool_slug in tool_reputation. DB says tool_slug
    return dbQuery(`
      UPDATE tool_reputation
      SET
        last_test_status = $2,
        last_test_at = NOW(),
        last_test_error = $3,
        health_score = CASE
          WHEN $2 = 'fail' THEN GREATEST(0, health_score - 0.2)
          WHEN $2 = 'pass' THEN LEAST(1.0, health_score + 0.1)
          ELSE health_score
        END
      WHERE tool_name = $1
    `, [result.toolName, result.status, result.errorMessage]).catch(e => console.warn("Failed tool_reputation update:", e.message));
  });

  // If P0 or P1 — notify Nexus immediately via world_state
  if (severity === 'P0' || severity === 'P1') {
    await dbQuery(`
      INSERT INTO world_state
        (domain, entity_id, key, value, written_by_agent, confidence, valid_until)
      VALUES
        ('tool_health', $1, 'critical_failure', $2, 'tool-test-runner', 1.0,
         NOW() + INTERVAL '48 hours')
      ON CONFLICT (domain, entity_id, key) DO UPDATE SET
        value = EXCLUDED.value, updated_at = NOW()
    `, [
      result.toolName,
      JSON.stringify({
        severity,
        error: result.errorMessage,
        errorType: result.errorType,
        failedAt: result.testedAt || new Date().toISOString(),
        findingId: finding?.id,
      })
    ]).catch(e => console.warn("Failed world_state insert:", e.message));
  }
}

function getFailureSeverity(result: ToolTestResult): 'P0' | 'P1' | 'P2' | 'P3' {
  // Auth errors on critical tools = P0
  if (result.errorType === 'auth' && isCriticalTool(result.toolName)) return 'P0';
  // Connection failures on external APIs = P1
  if (result.errorType === 'connection') return 'P1';
  // Auth errors on non-critical tools = P1
  if (result.errorType === 'auth') return 'P1';
  // Schema validation failures = P2
  if (result.schemaValid === false) return 'P2';
  // Everything else = P3
  return 'P3';
}

// Tools that are critical for GTM agents
const CRITICAL_TOOLS = new Set([
  'send_teams_dm', 'post_to_slack', 'send_email',
  'create_approval_request', 'read_gtm_report', 'read_fleet_health',
  'evaluate_assignment', 'evaluate_team_output', 'write_world_state',
  'read_company_knowledge', 'trigger_reflection_cycle',
]);

function isCriticalTool(toolName: string): boolean {
  return CRITICAL_TOOLS.has(toolName);
}

function buildFindingDescription(result: ToolTestResult): string {
  return [
    `Tool health test FAILED: ${result.toolName}`,
    `Strategy: ${result.testStrategy}`,
    `Error type: ${result.errorType ?? 'unknown'}`,
    `Error: ${result.errorMessage ?? 'no message'}`,
    `Response time: ${result.responseMs ?? 'N/A'}ms`,
    `Tested at: ${result.testedAt ?? new Date().toISOString()}`,
  ].join('\n');
}
