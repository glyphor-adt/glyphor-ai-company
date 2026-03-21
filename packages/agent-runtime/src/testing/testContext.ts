import { ToolContext } from '../types.js';
import { CompanyAgentRole as AgentRole } from '../types.js';
import { pool } from '@glyphor/shared/db';

export function buildTestContext(overrides?: Partial<ToolContext>): ToolContext {
  return {
    agentId: 'tool-test-runner',
    agentRole: 'test' as AgentRole,
    turnNumber: 0,
    dbPool: pool as any,
    ...overrides,
    // Add flags that tools can look out for if they support sandy-box execution
    isSandbox: true,
    dryRun: true,
  } as ToolContext & { isSandbox: boolean; dryRun: boolean };
}