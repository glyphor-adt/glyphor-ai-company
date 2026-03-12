/**
 * Layer 28 — Advancement Rollout Consistency
 *
 * Statically verifies the major rollout surfaces added across Phase 1 through
 * Phase 7 plus the follow-on security hardening work so regressions are caught
 * even before runtime smoke traffic exists.
 */

import { existsSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import type { LayerResult, SmokeTestConfig, TestResult } from '../types.js';
import { runTest } from '../utils/test.js';

function findMonorepoRoot(): string {
  const __filename = fileURLToPath(import.meta.url);
  let dir = dirname(__filename);
  while (dir !== dirname(dir)) {
    if (existsSync(resolve(dir, 'turbo.json'))) return dir;
    dir = dirname(dir);
  }
  return process.cwd();
}

const REPO_ROOT = findMonorepoRoot();

function readRepoFile(...segments: string[]): string {
  const filePath = resolve(REPO_ROOT, ...segments);
  if (!existsSync(filePath)) {
    throw new Error(`Expected file not found: ${segments.join('/')}`);
  }
  return readFileSync(filePath, 'utf8');
}

function assertIncludes(content: string, needle: string, label: string): void {
  if (!content.includes(needle)) {
    throw new Error(`Missing expected ${label}: ${needle}`);
  }
}

export async function run(_config: SmokeTestConfig): Promise<LayerResult> {
  const tests: TestResult[] = [];

  tests.push(
    await runTest('T28.1', 'Phase 1 Verification Rollout Wired', async () => {
      const migration = readRepoFile('db', 'migrations', '20260312160000_phase1_verification_columns.sql');
      const verificationPolicy = readRepoFile('packages', 'agent-runtime', 'src', 'verificationPolicy.ts');
      const baseRunner = readRepoFile('packages', 'agent-runtime', 'src', 'baseAgentRunner.ts');
      const companyRunner = readRepoFile('packages', 'agent-runtime', 'src', 'companyAgentRunner.ts');
      const schedulerServer = readRepoFile('packages', 'scheduler', 'src', 'server.ts');
      const financialsPage = readRepoFile('packages', 'dashboard', 'src', 'pages', 'Financials.tsx');

      assertIncludes(migration, 'ADD COLUMN IF NOT EXISTS verification_tier TEXT', 'verification tier migration');
      assertIncludes(migration, 'ADD COLUMN IF NOT EXISTS verification_reason TEXT', 'verification reason migration');
      assertIncludes(verificationPolicy, 'export function determineVerificationTier', 'verification policy entry point');
      assertIncludes(baseRunner, 'determineVerificationTier', 'base runner verification hook');
      assertIncludes(companyRunner, 'determineVerificationTier', 'company runner verification hook');
      assertIncludes(schedulerServer, 'verification_tier', 'agent run verification persistence');
      assertIncludes(financialsPage, 'verification_tier', 'dashboard verification analytics');

      return 'Phase 1 verification policy, persistence, and dashboard analytics are wired';
    }),
  );

  tests.push(
    await runTest('T28.2', 'Phase 2 Routing Rollout Wired', async () => {
      const subtaskRouter = readRepoFile('packages', 'agent-runtime', 'src', 'subtaskRouter.ts');
      const baseRunner = readRepoFile('packages', 'agent-runtime', 'src', 'baseAgentRunner.ts');
      const companyRunner = readRepoFile('packages', 'agent-runtime', 'src', 'companyAgentRunner.ts');
      const schedulerServer = readRepoFile('packages', 'scheduler', 'src', 'server.ts');
      const financialsPage = readRepoFile('packages', 'dashboard', 'src', 'pages', 'Financials.tsx');

      assertIncludes(subtaskRouter, 'export function routeSubtask', 'subtask routing entry point');
      assertIncludes(subtaskRouter, 'routingRule', 'routing decision metadata');
      assertIncludes(baseRunner, 'routeSubtask', 'base runner routing hook');
      assertIncludes(companyRunner, 'routeSubtask', 'company runner routing hook');
      assertIncludes(schedulerServer, 'routing_rule', 'routing audit persistence');
      assertIncludes(schedulerServer, 'routing_model', 'routing model persistence');
      assertIncludes(financialsPage, 'routing_model', 'dashboard routing analytics');
      assertIncludes(financialsPage, 'routing_rule', 'dashboard routing rule analytics');

      return 'Phase 2 routing and audit surfaces are wired';
    }),
  );

  tests.push(
    await runTest('T28.3', 'Phase 3 Security Hardening Wired', async () => {
      const migration = readRepoFile('db', 'migrations', '20260312193000_phase3_security_compartmentalization.sql');
      const behavioralFingerprint = readRepoFile('packages', 'agent-runtime', 'src', 'behavioralFingerprint.ts');
      const toolExecutor = readRepoFile('packages', 'agent-runtime', 'src', 'toolExecutor.ts');
      const graphReader = readRepoFile('packages', 'company-memory', 'src', 'graphReader.ts');
      const jitRetriever = readRepoFile('packages', 'agent-runtime', 'src', 'jitContextRetriever.ts');

      assertIncludes(migration, 'ADD COLUMN IF NOT EXISTS knowledge_access_scope TEXT[]', 'knowledge scope migration');
      assertIncludes(migration, 'CREATE TABLE IF NOT EXISTS security_anomalies', 'security anomalies migration');
      assertIncludes(behavioralFingerprint, 'export function detectBehavioralAnomalies', 'behavioral anomaly detector');
      assertIncludes(behavioralFingerprint, 'INSERT INTO security_anomalies', 'security anomaly persistence');
      assertIncludes(toolExecutor, 'detectBehavioralAnomalies', 'tool executor anomaly enforcement');
      assertIncludes(graphReader, 'knowledge_access_scope', 'graph scope enforcement');
      assertIncludes(jitRetriever, 'knowledge_access_scope', 'JIT scope enforcement');

      return 'Phase 3 behavioral security and knowledge compartmentalization are wired';
    }),
  );

  tests.push(
    await runTest('T28.4', 'Phase 4 A2A Rollout Wired', async () => {
      const migration = readRepoFile('db', 'migrations', '20260312200000_phase4_a2a_gateway.sql');
      const a2aServer = readRepoFile('packages', 'a2a-gateway', 'src', 'server.ts');
      const taskHandler = readRepoFile('packages', 'a2a-gateway', 'src', 'taskHandler.ts');
      const coreTools = readRepoFile('packages', 'agents', 'src', 'shared', 'coreTools.ts');

      assertIncludes(migration, 'CREATE TABLE IF NOT EXISTS a2a_clients', 'A2A client registry migration');
      assertIncludes(a2aServer, "/.well-known/agent.json", 'agent card endpoint');
      assertIncludes(a2aServer, "url.pathname === '/tasks/send'", 'A2A task submission endpoint');
      assertIncludes(taskHandler, 'FROM a2a_clients', 'A2A client auth lookup');
      assertIncludes(coreTools, 'discover_external_agents', 'external A2A discovery tool');

      return 'Phase 4 A2A gateway and external discovery surfaces are wired';
    }),
  );

  tests.push(
    await runTest('T28.5', 'Phase 5 Skill Learning Wired', async () => {
      const migration = readRepoFile('db', 'migrations', '20260312213000_phase5_skill_learning.sql');
      const existingSkillLibrary = readRepoFile('db', 'migrations', '20260227100006_skill_library.sql');
      const skillLearning = readRepoFile('packages', 'agent-runtime', 'src', 'skillLearning.ts');
      const baseRunner = readRepoFile('packages', 'agent-runtime', 'src', 'baseAgentRunner.ts');
      const companyRunner = readRepoFile('packages', 'agent-runtime', 'src', 'companyAgentRunner.ts');
      const jitRetriever = readRepoFile('packages', 'agent-runtime', 'src', 'jitContextRetriever.ts');

      assertIncludes(migration, 'CREATE TABLE IF NOT EXISTS proposed_skills', 'Phase 5 migration table');
      assertIncludes(existingSkillLibrary, 'CREATE TABLE IF NOT EXISTS task_skill_map', 'existing task skill map migration');
      assertIncludes(skillLearning, 'export async function learnFromAgentRun', 'skill learning entry point');
      assertIncludes(baseRunner, 'learnFromAgentRun', 'base runner skill learning hook');
      assertIncludes(companyRunner, 'learnFromAgentRun', 'company runner skill learning hook');
      assertIncludes(jitRetriever, 'queryTransferableSkills', 'transferable skill retrieval');
      assertIncludes(jitRetriever, 'SELECT task_regex, skill_slug FROM task_skill_map', 'task skill mapping query');
      assertIncludes(jitRetriever, 'FROM agent_skills ags', 'cross-agent skill transfer query');

      return 'Phase 5 skill extraction and transferable-skill retrieval surfaces are wired';
    }),
  );

  tests.push(
    await runTest('T28.6', 'Phase 6 Cascade Predictions Wired', async () => {
      const migration = readRepoFile('db', 'migrations', '20260312230000_phase6_cascade_predictions.sql');
      const simulationEngine = readRepoFile('packages', 'scheduler', 'src', 'simulationEngine.ts');
      const server = readRepoFile('packages', 'scheduler', 'src', 'server.ts');
      const cronManager = readRepoFile('packages', 'scheduler', 'src', 'cronManager.ts');
      const strategyPage = readRepoFile('packages', 'dashboard', 'src', 'pages', 'Strategy.tsx');

      assertIncludes(migration, 'CREATE TABLE IF NOT EXISTS cascade_predictions', 'cascade predictions migration');
      assertIncludes(simulationEngine, 'async runQuick(req: QuickCascadeRequest)', 'quick cascade preview');
      assertIncludes(simulationEngine, 'INSERT INTO cascade_predictions', 'prediction persistence');
      assertIncludes(server, '/cascade/evaluate', 'cascade evaluator endpoint');
      assertIncludes(server, 'simulationEngine.runQuick', 'authority preview wiring');
      assertIncludes(cronManager, "endpoint: '/cascade/evaluate'", 'weekly cascade evaluator job');
      assertIncludes(strategyPage, 'Prediction Journal', 'dashboard prediction journal UI');

      return 'Phase 6 cascade prediction persistence, previewing, scheduling, and UI surfaces are wired';
    }),
  );

  tests.push(
    await runTest('T28.7', 'Phase 7 Agent SDK Wired', async () => {
      const migration = readRepoFile('db', 'migrations', '20260312234500_phase7_agent_sdk.sql');
      const server = readRepoFile('packages', 'scheduler', 'src', 'server.ts');
      const clientSdk = readRepoFile('packages', 'scheduler', 'src', 'clientSdk.ts');
      const sdkIndex = readRepoFile('packages', 'agent-sdk', 'src', 'index.ts');
      const sdkClient = readRepoFile('packages', 'agent-sdk', 'src', 'client.ts');

      assertIncludes(migration, 'ADD COLUMN IF NOT EXISTS created_via', 'SDK source migration');
      assertIncludes(migration, 'ADD COLUMN IF NOT EXISTS client_id', 'SDK client audit migration');
      assertIncludes(server, "url === '/sdk/agents'", 'scheduler SDK routes');
      assertIncludes(clientSdk, 'export async function createClientSdkAgent', 'scheduler SDK create handler');
      assertIncludes(clientSdk, 'export async function retireClientSdkAgent', 'scheduler SDK retire handler');
      assertIncludes(sdkIndex, "export { AgentSdkClient }", 'SDK client export');
      assertIncludes(sdkClient, "return this.request<AgentRecord[]>('/sdk/agents')", 'SDK list agents API');
      assertIncludes(sdkClient, "return this.request<AgentRecord>('/sdk/agents', {", 'SDK create agent API');

      return 'Phase 7 SDK schema, scheduler routes, and typed client package are wired';
    }),
  );

  tests.push(
    await runTest('T28.8', 'High-Stakes Tool Verification Wired', async () => {
      const verifierRunner = readRepoFile('packages', 'agent-runtime', 'src', 'verifierRunner.ts');
      const toolExecutor = readRepoFile('packages', 'agent-runtime', 'src', 'toolExecutor.ts');
      const types = readRepoFile('packages', 'agent-runtime', 'src', 'types.ts');
      const testsFile = readRepoFile('packages', 'agent-runtime', 'src', '__tests__', 'toolExecutor.test.ts');

      assertIncludes(verifierRunner, 'async verifyToolCall(params:', 'tool-call verification entry point');
      assertIncludes(toolExecutor, 'CROSS_AGENT_VERIFICATION_TOOLS', 'high-stakes tool verification allowlist');
      assertIncludes(toolExecutor, 'this.verifierRunner.verifyToolCall', 'tool-call verification enforcement');
      assertIncludes(toolExecutor, "'TOOL_VERIFICATION_BLOCK'", 'security block event logging');
      assertIncludes(types, "| 'TOOL_VERIFICATION_BLOCK'", 'security event type');
      assertIncludes(testsFile, 'blocks high-stakes tools when cross-model verification returns BLOCK', 'block-path coverage');
      assertIncludes(testsFile, 'allows high-stakes tools when cross-model verification approves', 'allow-path coverage');

      return 'High-stakes tool verification is wired with security logging and coverage';
    }),
  );

  return { layer: 28, name: 'Advancement Rollout', tests };
}
