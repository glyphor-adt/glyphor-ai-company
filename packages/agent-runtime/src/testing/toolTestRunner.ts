import { systemQuery as dbQuery } from '@glyphor/shared/db';
import { runTier1ForAllTools } from './tier1SchemaValidator.js';
import { runTier2 } from './tier2ConnectivityTester.js';
import { runTier3Single } from './tier3TestCases.js';
import { handleToolTestFailure } from './failureHandler.js';
import type { ToolTestResult } from './failureHandler.js';
import { getAllKnownTools } from '../toolRegistry.js';
import type { ToolClassification } from './toolClassifier.js';
import * as crypto from 'crypto';

export interface ToolTestRunSummary {
  testRunId: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  errors: number;
  auth_failures: number;
  connection_failures: number;
  schema_failures: number;
  avg_response_ms: number;
  topFailures: Array<{ tool_name: string; error_type: string; error_message: string }>;
}

async function countAllTools(): Promise<number> {
  const allTools = getAllKnownTools();
  const dynamicQuery = await dbQuery<{ name: string }>(
    `SELECT name FROM tool_registry WHERE is_active = true`
  );
  const allToolNames = [...new Set([...allTools, ...dynamicQuery.map(t => t.name)])];
  return allToolNames.length;
}

export async function runFullToolHealthCheck(options: {
  triggeredBy: 'scheduled' | 'manual' | 'deploy';
  tiers?: (1 | 2 | 3)[];  // default: all tiers
}): Promise<ToolTestRunSummary> {

  const tiers = options.tiers ?? [1, 2, 3];
  const testRunId = crypto.randomUUID();

  // Create run record
  await dbQuery(`
    INSERT INTO tool_test_runs (id, triggered_by, total_tools)
    VALUES ($1, $2, $3)
  `, [testRunId, options.triggeredBy, await countAllTools()]);

  const allClassificationsResult = await dbQuery(
    `SELECT tool_name as "toolName", risk_tier as "riskTier", test_strategy as "testStrategy", source FROM tool_test_classifications`
  );
  const allClassifications = allClassificationsResult as ToolClassification[];

  // Tier 1: Schema validation — all tools, fast
  if (tiers.includes(1)) {
    console.log('--- TIER 1: Schema Validation ---');
    await runTier1ForAllTools(testRunId);
  }

  // Tier 2: Connectivity — read_only + external_api tools
  if (tiers.includes(2)) {
    console.log('--- TIER 2: Connectivity Tests ---');
    const tier2 = allClassifications.filter(c =>
      c.testStrategy === 'live' || c.testStrategy === 'probe'
    );
    await runTier2(testRunId, tier2);
  }

  // Tier 3: Execution — destructive + write tools with test cases
  if (tiers.includes(3)) {
    console.log('--- TIER 3: Execution Tests ---');
    const tier3 = allClassifications.filter(c => c.testStrategy === 'sandbox');
    for (const tool of tier3) {
      await runTier3Single(tool.toolName, testRunId);
    }
  }

  // Process failures
  const failuresQuery = await dbQuery(`
    SELECT 
      tool_name as "toolName", 
      risk_tier as "riskTier", 
      test_strategy as "testStrategy", 
      test_run_id as "testRunId", 
      status, 
      response_ms as "responseMs", 
      error_message as "errorMessage", 
      error_type as "errorType", 
      schema_valid as "schemaValid", 
      connectivity_ok as "connectivityOk", 
      execution_ok as "executionOk", 
      tested_at as "testedAt"
    FROM tool_test_results
    WHERE test_run_id = $1 AND status = 'fail'
  `, [testRunId]);
  
  const failures = failuresQuery as ToolTestResult[];

  for (const failure of failures) {
    await handleToolTestFailure(failure);
  }

  // Build summary
  const summary = await buildRunSummary(testRunId);

  // Update run record
  await dbQuery(`
    UPDATE tool_test_runs SET
      completed_at = NOW(),
      passed = $2, failed = $3, skipped = $4, errors = $5
    WHERE id = $1
  `, [testRunId, summary.passed, summary.failed, summary.skipped, summary.errors]);

  return summary;
}

async function buildRunSummary(testRunId: string): Promise<ToolTestRunSummary> {
  const statsQuery = await dbQuery(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status = 'pass')::int AS passed,
      COUNT(*) FILTER (WHERE status = 'fail')::int AS failed,
      COUNT(*) FILTER (WHERE status = 'skip')::int AS skipped,
      COUNT(*) FILTER (WHERE status = 'error')::int AS errors,
      COUNT(*) FILTER (WHERE error_type = 'auth')::int AS auth_failures,
      COUNT(*) FILTER (WHERE error_type = 'connection')::int AS connection_failures,
      COUNT(*) FILTER (WHERE NOT schema_valid)::int AS schema_failures,
      AVG(response_ms) FILTER (WHERE response_ms IS NOT NULL) AS avg_response_ms
    FROM tool_test_results WHERE test_run_id = $1
  `, [testRunId]);

  const stats = statsQuery[0];

  const topFailuresQuery = await dbQuery(`
    SELECT tool_name, error_type, error_message
    FROM tool_test_results
    WHERE test_run_id = $1 AND status = 'fail'
    ORDER BY CASE error_type
      WHEN 'auth' THEN 1 WHEN 'connection' THEN 2 ELSE 3 END
    LIMIT 20
  `, [testRunId]);

  const topFailures = topFailuresQuery;

  return { ...stats, topFailures, testRunId };
}
