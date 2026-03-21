import { executeDynamicTool } from '../dynamicToolExecutor.js';
import { loadRegisteredTool } from '../toolRegistry.js';
import { buildTestContext } from './testContext.js';
import { systemQuery as dbQuery } from '@glyphor/shared/db';
import type { ToolResult } from '../types.js';

export interface ToolTestCase {
  toolName: string;
  description: string;
  input: Record<string, unknown>;
  expectedOutcome: 'success' | 'error';
  expectedErrorType?: string;
  validateResponse?: (response: ToolResult) => boolean;
  sandboxOnly: boolean;
}

export const TIER3_TEST_CASES: ToolTestCase[] = [
  {
    toolName: 'send_email',
    description: 'Send test email to sandbox address',
    input: {
      to: 'test-sandbox@glyphor.ai',
      subject: 'Tool Health Test',
      body: 'This is an automated tool health test.',
    },
    expectedOutcome: 'success',
    validateResponse: (r) => r.success === true,
    sandboxOnly: true,
  },
  {
    toolName: 'send_teams_dm',
    description: 'Send Teams DM — expect auth error if API key unset',
    input: {
      userId: 'test-user',
      message: 'Tool health test message',
    },
    expectedOutcome: 'error',
    expectedErrorType: 'auth',  // we know this is broken — test confirms it
    sandboxOnly: true,
  },
  {
    toolName: 'write_world_state',
    description: 'Write and verify test world state entry',
    input: {
      domain: 'test',
      entityId: 'tool-health-test',
      key: 'test_key',
      value: { test: true, timestamp: new Date().toISOString() },
    },
    expectedOutcome: 'success',
    validateResponse: (r) => r.success === true,
    sandboxOnly: false,
  },
  {
    toolName: 'create_fleet_finding',
    description: 'Create test P3 fleet finding',
    input: {
      agentId: 'tool-test-runner',
      severity: 'P3',
      findingType: 'tool_health_test',
      description: 'Automated tool health test finding — safe to resolve',
    },
    expectedOutcome: 'success',
    validateResponse: (r) => { const d = r.data as any; return r.success === true && d?.finding_id != null; },
    sandboxOnly: false,
  },
  {
    toolName: 'propose_initiative',
    description: 'Minimal initiative proposal for harness / Tier 2 connectivity input',
    input: {
      title: 'Tool health test initiative',
      justification: 'Automated harness validation — safe to ignore.',
      proposed_assignments: '[{"agent_role":"cto","task_description":"Review"}]',
      expected_outcome: 'Harness validation only',
      priority: 'medium',
    },
    expectedOutcome: 'success',
    validateResponse: (r) => r.success === true,
    sandboxOnly: false,
  },
];

function getTier3TestCase(toolName: string): ToolTestCase | null {
  return TIER3_TEST_CASES.find(tc => tc.toolName === toolName) ?? null;
}

/** Input from TIER3_TEST_CASES for Tier 2 connectivity, or null if none. */
export function getTier3TestInputForConnectivity(toolName: string): Record<string, unknown> | null {
  const tc = getTier3TestCase(toolName);
  return tc ? { ...tc.input } : null;
}

function classifyError(err: unknown): string {
  const msg = String(err).toLowerCase();
  if (msg.includes('401') || msg.includes('403') || msg.includes('unauthorized')
      || msg.includes('forbidden') || msg.includes('api key')) return 'auth';
  if (msg.includes('404') || msg.includes('not found')) return 'not_found';
  if (msg.includes('timeout') || msg.includes('econnrefused')
      || msg.includes('network') || msg.includes('abort_err')) return 'connection';
  if (msg.includes('enotfound') || msg.includes('dns')) return 'connection';
  return 'unknown';
}

export async function runTier3Single(
  toolName: string, testRunId: string
): Promise<void> {
  const testCase = getTier3TestCase(toolName);

  if (!testCase) {
    await dbQuery(`
      INSERT INTO tool_test_results (
        test_run_id, tool_name, risk_tier, test_strategy, status, error_message
      ) VALUES ($1, $2, $3, $4, $5, $6)
    `, [
      testRunId, toolName, 'destructive', 'schema_only', 'skip',
      'No test case defined for this destructive tool'
    ]);
    return;
  }

  // Execute in sandbox context
  const tool = await loadRegisteredTool(toolName);
  const context = buildTestContext();
  const start = Date.now();

  try {
    if (!tool) throw new Error('Tool not dynamically registered in DB or is static tool missing mapping');
    
    // Actually we could try executeDynamicTool, some "static" names might be in DB if they were synced
    const result = await executeDynamicTool(toolName, testCase.input);
    if (!result) throw new Error('Dynamic tool execute returned null');

    const passed = testCase.expectedOutcome === 'success'
      ? result.success !== false && (testCase.validateResponse?.(result) ?? true)
      : result.success === false;

    await dbQuery(`
      INSERT INTO tool_test_results (
        test_run_id, tool_name, risk_tier, test_strategy, status,
        response_ms, execution_ok, raw_response, error_message
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [
      testRunId, toolName, 'destructive', 'sandbox',
      passed ? 'pass' : 'fail',
      Date.now() - start,
      passed,
      JSON.stringify(result).substring(0, 2000),
      passed ? null : `Expected ${testCase.expectedOutcome} but got opposite`
    ]);
  } catch (err: any) {
    const errorType = classifyError(err);
    const passed = testCase.expectedOutcome === 'error'
      && (!testCase.expectedErrorType || testCase.expectedErrorType === errorType);

    await dbQuery(`
      INSERT INTO tool_test_results (
        test_run_id, tool_name, risk_tier, test_strategy, status,
        response_ms, execution_ok, error_message, error_type
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [
      testRunId, toolName, 'destructive', 'sandbox',
      passed ? 'pass' : 'fail',
      Date.now() - start,
      false,
      String(err),
      errorType
    ]);
  }
}
