/**
 * Tool Executor — Manages tool set and dispatches tool calls
 *
 * Enforcement layers (simplified for MCP architecture):
 *   1. Emergency block check (is_blocked in agent_tool_grants)
 *   2. Rate limit check (prevents runaway loops)
 *   3. Budget check (controls LLM cost)
 *   4. Execute + timeout
 *
 * Grant check and scope check have been removed — Entra agent identities
 * and MCP server-side scoping now handle tool access control. Static tools
 * (in the agent's tool set) are authorized by code. MCP tools are scoped
 * by the agent's Entra app roles.
 *
 * The agent_tool_grants table is retained as an emergency override:
 * set is_blocked=true to immediately revoke a tool without an Entra update.
 */

import type {
  ToolDefinition,
  ToolParameter,
  ToolContext,
  ToolResult,
  ToolDeclaration,
  CompanyAgentRole,
  ToolCallLog,
  SecurityEvent,
  SecurityEventType,
  ToolRetrievalMeta,
} from './types.js';
import { AGENT_BUDGETS } from './types.js';
import { systemQuery } from '@glyphor/shared/db';
import { buildSearchableToolDescription } from './toolRegistry.js';
import type { FormalVerifier } from './formalVerifier.js';
import { executeDynamicTool } from './dynamicToolExecutor.js';
import { HIGH_STAKES_TOOLS, preCheckTool } from './constitutionalPreCheck.js';
import type { ConstitutionalGovernor } from './constitutionalGovernor.js';
import type { ModelClient } from './modelClient.js';
import { VerifierRunner } from './verifierRunner.js';
import type { RedisCache } from './redisCache.js';
import { recordToolCall, detectToolSource } from './toolReputationTracker.js';
import { applyPatchToGitHub } from './patchHarness.js';
import {
  detectBehavioralAnomalies,
  loadBehaviorProfile,
  persistBehavioralAnomalies,
} from './behavioralFingerprint.js';

// ─── Tool Call Trace Persistence ───────────────────────────────
// Fire-and-forget write of each tool call to tool_call_traces for
// eval and retrieval analytics. Never throws.
async function persistToolCallTrace(
  log: ToolCallLog,
  runId: string | undefined,
  assignmentId: string | undefined,
  turnNumber: number,
  retrievalMeta?: ToolRetrievalMeta,
): Promise<void> {
  if (!runId) return;
  try {
    await systemQuery(
      `INSERT INTO tool_call_traces
       (run_id, assignment_id, agent_id, agent_role, tool_name, args,
        result_success, result_data, result_error, files_written, memory_keys_written,
        constitutional_check, estimated_cost_usd, turn_number,
        retrieval_method, retrieval_score, tools_available, model_cap)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [
        runId,
        assignmentId ?? null,
        log.agentId,
        log.agentRole,
        log.toolName,
        JSON.stringify(log.args),
        log.result.success,
        log.result.data != null ? JSON.stringify(log.result.data) : null,
        log.result.error ?? null,
        log.result.filesWritten ?? 0,
        log.result.memoryKeysWritten ?? 0,
        log.result.constitutional_check ? JSON.stringify(log.result.constitutional_check) : null,
        log.estimatedCostUsd,
        turnNumber,
        retrievalMeta?.method ?? null,
        retrievalMeta?.score ?? null,
        retrievalMeta?.toolsAvailable ?? null,
        retrievalMeta?.modelCap ?? null,
      ],
    );
  } catch {
    // fire-and-forget — never block tool execution
  }
}

// ─── Emergency Block Cache ─────────────────────────────────────
const BLOCK_CACHE_TTL_MS = 60_000; // 60 seconds

interface BlockCacheEntry {
  blockedTools: Set<string>;
  fetchedAt: number;
}

const blockCache = new Map<string, BlockCacheEntry>(); // role → cache entry

/**
 * Check if a tool is emergency-blocked for an agent via agent_tool_grants.
 * This is the fast-path override: set is_blocked=true to instantly revoke
 * a tool without waiting for an Entra role update.
 * Results are cached for 60s per role.
 */
export async function isToolBlocked(
  agentRole: CompanyAgentRole,
  toolName: string,
): Promise<boolean> {
  const now = Date.now();
  const cached = blockCache.get(agentRole);

  if (cached && now - cached.fetchedAt < BLOCK_CACHE_TTL_MS) {
    return cached.blockedTools.has(toolName);
  }

  try {
    const data = await systemQuery<{ tool_name: string }>(
      `SELECT tool_name FROM agent_tool_grants WHERE agent_role = $1 AND is_blocked = true`,
      [agentRole],
    );

    const blockedTools = new Set(data.map((row) => row.tool_name));
    blockCache.set(agentRole, { blockedTools, fetchedAt: now });

    return blockedTools.has(toolName);
  } catch {
    // On DB error, don't block (fail-open for availability)
    return false;
  }
}

/** Invalidate the block cache for a role (called after block/unblock). */
export function invalidateBlockCache(agentRole?: string): void {
  if (agentRole) {
    blockCache.delete(agentRole);
  } else {
    blockCache.clear();
  }
}

// ── Legacy exports (kept for backward compatibility) ────────────

/** @deprecated Use isToolBlocked instead. Grant checks are now handled by Entra identity. */
export async function isToolGranted(
  agentRole: CompanyAgentRole,
  _toolName: string,
): Promise<boolean> {
  return true; // All tools are implicitly granted; scoping is via Entra identity
}

/** @deprecated Grant cache replaced by block cache. */
export function invalidateGrantCache(agentRole?: string): void {
  invalidateBlockCache(agentRole);
}

/** @deprecated Tool grants are now managed by Entra identity. Returns static tool names. */
export async function loadGrantedToolNames(
  _agentRole: CompanyAgentRole,
): Promise<string[]> {
  return []; // Callers should use tool declarations instead
}

const DEFAULT_TOOL_TIMEOUT_MS = 30_000;
const LONG_TOOL_TIMEOUT_MS = 120_000;
const VERY_LONG_TOOL_TIMEOUT_MS = 420_000;

// Company tools that legitimately take longer (API calls, report generation)
const LONG_RUNNING_TOOLS = new Set([
  'generate_briefing',
  'analyze_usage',
  'competitive_scan',
  'generate_content',
  'financial_report',
  'health_scoring',
  'kyc_research',
  'draft_blog_post',
  'draft_content',
  'compile_dossier',
  'run_test_suite',
  'run_cohort_analysis',
  'calculate_health_scores',
]);

const VERY_LONG_RUNNING_TOOLS = new Set([
  'invoke_fuse_build',
  'invoke_fuse_iterate',
  'invoke_fuse_upgrade',
]);

// Tools that are safe to execute in dry-run mode (read-only / computation)
const READ_ONLY_PREFIXES = ['get_', 'read_', 'calculate_', 'recall_', 'query_', 'search_', 'check_', 'fetch_', 'discover_', 'monitor_'];

function isReadOnlyTool(name: string): boolean {
  return READ_ONLY_PREFIXES.some((prefix) => name.startsWith(prefix));
}

function resolveToolAlias(name: string, tools: Map<string, ToolDefinition>): string {
  if (tools.has(name) || getVirtualTool(name)) return name;

  const mcpQualified = name.match(/^mcp_[^./]+[./](.+)$/);
  if (!mcpQualified?.[1]) return name;

  const candidate = mcpQualified[1];
  if (tools.has(candidate) || getVirtualTool(candidate)) {
    return candidate;
  }

  return name;
}

function getVirtualTool(name: string): ToolDefinition | null {
  if (name !== 'apply_patch_call') return null;
  return {
    name,
    description: 'Apply a structured V4A patch to one or more GitHub files on a feature branch.',
    parameters: {
      repo: { type: 'string', description: 'GitHub repo name', required: true },
      branch: { type: 'string', description: 'Feature branch name', required: true },
      commit_message: { type: 'string', description: 'Commit message', required: true },
      patch: { type: 'object', description: 'V4A patch document', required: true },
    },
    execute: async (params, context) => applyPatchToGitHub({
      repo: params.repo as string,
      branch: params.branch as string,
      commit_message: params.commit_message as string,
      patch: params.patch as string | import('./v4aDiff.js').V4APatchDocument,
    }, context),
  };
}

const FOUNDER_ALIASES = new Set(['kristina', 'andrew', 'both']);

function normalizeAndValidateToolParams(
  toolName: string,
  tool: ToolDefinition,
  rawParams: Record<string, unknown>,
): { params: Record<string, unknown>; error?: string } {
  const params: Record<string, unknown> = { ...rawParams };

  if (toolName === 'send_dm') {
    const toAlias = typeof params.to === 'string'
      ? params.to.trim().toLowerCase()
      : null;

    if ((!params.recipient || String(params.recipient).trim().length === 0) && toAlias) {
      if (toAlias === 'kristina' || toAlias === 'andrew') {
        params.recipient = toAlias;
      } else {
        return {
          params,
          error:
            'send_dm supports one founder per call via recipient="kristina" or recipient="andrew". ' +
            'For both founders, call send_dm twice.',
        };
      }
    }

    if (typeof params.recipient === 'string') {
      params.recipient = params.recipient.trim().toLowerCase();
      const recipient = String(params.recipient);
      if (recipient === 'both' || recipient.includes(',')) {
        return {
          params,
          error:
            'send_dm supports one founder per call via recipient="kristina" or recipient="andrew". ' +
            'For both founders, call send_dm twice.',
        };
      }
    }
  }

  if (toolName === 'send_agent_message') {
    const toAgent = typeof params.to_agent === 'string'
      ? params.to_agent.trim().toLowerCase()
      : '';
    if (FOUNDER_ALIASES.has(toAgent)) {
      return {
        params,
        error:
          'Founders are not valid recipients for send_agent_message. ' +
          'Use send_dm with recipient="kristina" or recipient="andrew". ' +
          'For both founders, call send_dm twice.',
      };
    }
  }

  const missingRequired = Object.entries(tool.parameters)
    .filter(([, spec]) => spec.required)
    .map(([name]) => name)
    .filter((name) => {
      const value = params[name];
      return value === undefined
        || value === null
        || (typeof value === 'string' && value.trim().length === 0);
    });

  if (missingRequired.length > 0) {
    return {
      params,
      error: `Missing required parameter(s) for ${toolName}: ${missingRequired.join(', ')}`,
    };
  }

  for (const [name, spec] of Object.entries(tool.parameters)) {
    if (!spec.enum || spec.enum.length === 0) continue;
    const value = params[name];
    if (value === undefined || value === null) continue;
    if (!spec.enum.includes(String(value))) {
      return {
        params,
        error:
          `Invalid value for ${toolName}.${name}: ${String(value)}. ` +
          `Allowed: ${spec.enum.join(', ')}`,
      };
    }
  }

  return { params };
}

function toJsonSchema(param: ToolParameter): Record<string, unknown> {
  const schema: Record<string, unknown> = {
    type: param.type,
    description: param.description,
  };

  if (param.enum) schema.enum = param.enum;

  if (param.type === 'array') {
    schema.items = param.items ? toJsonSchema(param.items) : { type: 'string' };
  } else if (param.items) {
    schema.items = toJsonSchema(param.items);
  }

  if (param.properties) {
    const properties = Object.fromEntries(
      Object.entries(param.properties).map(([key, value]) => [key, toJsonSchema(value)]),
    );
    const required = Object.entries(param.properties)
      .filter(([, value]) => value.required)
      .map(([key]) => key);
    schema.properties = properties;
    if (required.length > 0) schema.required = required;
  }

  return schema;
}

// ─── MUTATION VERIFICATION ─────────────────────────────────────────
const MUTATION_PREFIXES = ['update_', 'create_', 'delete_', 'set_', 'assign_', 'grant_', 'revoke_', 'dispatch_'];

const isMutation = (toolName: string): boolean =>
  MUTATION_PREFIXES.some(p => toolName.startsWith(p));

const CROSS_AGENT_VERIFICATION_TOOLS = new Set([
  ...HIGH_STAKES_TOOLS,
  'send_dm',
  'send_teams_dm',
  'create_calendar_event',
  'revoke_tool_access',
]);

// ─── DATA-EVIDENCE GATE ────────────────────────────────────────
// Tools that MUST have prior data-sourcing tool calls with substantive
// data before they can execute.  Prevents agents from fabricating
// decisions or reports based on hallucinated data.
const DATA_EVIDENCE_REQUIRED = new Set([
  'create_decision',
  'write_pipeline_report',
]);

/** Tools considered valid data sources for the evidence gate. */
const DATA_SOURCE_TOOLS = new Set([
  'get_product_metrics',
  'get_financials',
  'get_recent_activity',
  'read_company_memory',
  'query_stripe_mrr',
  'query_stripe_subscriptions',
]);

/** Maps mutation tools to their read counterpart for post-write verification. */
const VERIFICATION_MAP: Record<string, { name: string; paramKey: string }> = {
  'update_agent_profile': { name: 'get_agent_profile', paramKey: 'agent_role' },
  'update_company_knowledge': { name: 'get_company_knowledge', paramKey: 'id' },
};

/** Rough cost estimate per tool call in USD */
function estimateToolCost(toolName: string): number {
  if (isReadOnlyTool(toolName)) return 0.001;
  if (VERY_LONG_RUNNING_TOOLS.has(toolName)) return 0.02;
  if (LONG_RUNNING_TOOLS.has(toolName)) return 0.01;
  return 0.003;
}

export class ToolExecutor {
  private tools: Map<string, ToolDefinition>;
  private dryRun: boolean;

  // Enforcement state
  private callLog: ToolCallLog[] = [];
  private securityLog: SecurityEvent[] = [];
  private rateCounts: Map<string, number[]> = new Map(); // "role:tool" → timestamps
  private runCosts: Map<string, number> = new Map();     // agentId → cumulative cost this run
  private runToolCounts: Map<string, Map<string, number>> = new Map(); // agentId → per-tool counts this run
  private dailyCosts: Map<string, number> = new Map();   // role → cumulative cost today
  private monthlyCosts: Map<string, number> = new Map(); // role → cumulative cost this month
  private enforcementEnabled: boolean;
  private formalVerifier: FormalVerifier | null;
  private constitutionalGovernor: ConstitutionalGovernor | null = null;
  private modelClient: ModelClient | null = null;
  private redisCache: RedisCache | null = null;
  private verifierRunner: VerifierRunner | null = null;

  constructor(tools: ToolDefinition[], dryRun = false, enforcement = true, formalVerifier?: FormalVerifier) {
    this.tools = new Map(tools.map((t) => [t.name, t]));
    this.dryRun = dryRun;
    this.enforcementEnabled = enforcement;
    this.formalVerifier = formalVerifier ?? null;
  }

  /** Attach constitutional pre-check dependencies. Call once after construction. */
  setConstitutionalDeps(deps: {
    constitutionalGovernor?: ConstitutionalGovernor;
    modelClient?: ModelClient;
    redisCache?: RedisCache;
  }): void {
    this.constitutionalGovernor = deps.constitutionalGovernor ?? null;
    this.modelClient = deps.modelClient ?? null;
    this.redisCache = deps.redisCache ?? null;
    this.verifierRunner = deps.modelClient ? new VerifierRunner(deps.modelClient) : null;
  }

  // ─── Cost Tracking ────────────────────────────────────────────

  addDailyCost(role: CompanyAgentRole, amount: number): void {
    this.dailyCosts.set(role, (this.dailyCosts.get(role) ?? 0) + amount);
  }

  addMonthlyCost(role: CompanyAgentRole, amount: number): void {
    this.monthlyCosts.set(role, (this.monthlyCosts.get(role) ?? 0) + amount);
  }

  setDailyCost(role: CompanyAgentRole, amount: number): void {
    this.dailyCosts.set(role, amount);
  }

  setMonthlyCost(role: CompanyAgentRole, amount: number): void {
    this.monthlyCosts.set(role, amount);
  }

  // ─── Log Access ───────────────────────────────────────────────

  getCallLog(): ToolCallLog[] {
    return this.callLog;
  }

  getSecurityLog(): SecurityEvent[] {
    return this.securityLog;
  }

  // ─── Enforcement Helpers ──────────────────────────────────────

  private logSecurityEvent(
    agentId: string,
    agentRole: CompanyAgentRole,
    toolName: string,
    eventType: SecurityEventType,
    details?: unknown,
  ): void {
    const event: SecurityEvent = {
      agentId,
      agentRole,
      toolName,
      eventType,
      details,
      timestamp: new Date().toISOString(),
    };
    this.securityLog.push(event);
    console.warn(`[SECURITY] ${eventType}: agent=${agentRole} tool=${toolName}`, details ?? '');
  }

  private checkRateLimit(role: CompanyAgentRole, toolName: string, limit: number): boolean {
    const key = `${role}:${toolName}`;
    const now = Date.now();
    const hourAgo = now - 60 * 60 * 1000;
    const timestamps = (this.rateCounts.get(key) ?? []).filter((t) => t > hourAgo);
    if (timestamps.length >= limit) return false;
    timestamps.push(now);
    this.rateCounts.set(key, timestamps);
    return true;
  }

  private wouldExceedBudget(
    agentId: string,
    role: CompanyAgentRole,
    estimatedCost: number,
  ): boolean {
    const budget = AGENT_BUDGETS[role];
    if (!budget) return false;

    const runCost = (this.runCosts.get(agentId) ?? 0) + estimatedCost;
    if (runCost > budget.perRunUsd) return true;

    const dailyCost = (this.dailyCosts.get(role) ?? 0) + estimatedCost;
    if (dailyCost > budget.dailyUsd) return true;

    const monthlyCost = (this.monthlyCosts.get(role) ?? 0) + estimatedCost;
    if (monthlyCost > budget.monthlyUsd) return true;

    return false;
  }

  private logToolCall(
    agentId: string,
    agentRole: CompanyAgentRole,
    toolName: string,
    args: Record<string, unknown>,
    result: ToolResult,
    costUsd: number,
  ): void {
    this.callLog.push({
      agentId,
      agentRole,
      toolName,
      args,
      result,
      estimatedCostUsd: costUsd,
      timestamp: new Date().toISOString(),
    });
  }

  // ─── Public API ───────────────────────────────────────────────

  addTool(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  removeTool(name: string): void {
    this.tools.delete(name);
  }

  hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  getDeclarations(): ToolDeclaration[] {
    return Array.from(this.tools.values()).map((t): ToolDeclaration => {
      const required = Object.entries(t.parameters)
        .filter(([, v]) => v.required)
        .map(([k]) => k);

      const params: ToolDeclaration['parameters'] = {
        type: 'object',
        properties: Object.fromEntries(
          Object.entries(t.parameters).map(([k, v]) => [k, toJsonSchema(v)]),
        ),
      };

      // Gemini rejects an empty required array — omit the field when no parameters are required.
      if (required.length > 0) params.required = required;

      return {
        name: t.name,
        description: buildSearchableToolDescription(t.name, t.description),
        parameters: params,
      };
    });
  }

  async execute(
    toolName: string,
    params: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> {
    const requestedToolName = toolName;
    toolName = resolveToolAlias(toolName, this.tools);
    if (requestedToolName !== toolName) {
      console.warn(`[ToolExecutor] Aliased requested tool ${requestedToolName} -> ${toolName}`);
    }

    const tool = this.tools.get(toolName) ?? getVirtualTool(toolName);
    if (!tool) {
      // ─── Runtime tool routing ──────────────────────────────
      // Tools created mid-run via RuntimeToolFactory are prefixed
      // with 'runtime_' and executed through the factory.
      if (toolName.startsWith('runtime_') && context.runtimeToolFactory) {
        const rtStart = Date.now();
        try {
          const result = await context.runtimeToolFactory.execute(toolName, params as Record<string, any>);
          recordToolCall(toolName, 'runtime', true, false, Date.now() - rtStart)
            .catch(err => console.warn('[ToolReputation] tracking failed:', err));
          return { success: true, data: result };
        } catch (err: any) {
          const rtLatency = Date.now() - rtStart;
          const rtTimedOut = err.message?.includes('timeout') || rtLatency >= 60_000;
          recordToolCall(toolName, 'runtime', false, rtTimedOut, rtLatency)
            .catch(e => console.warn('[ToolReputation] tracking failed:', e));
          return { success: false, error: `Runtime tool error: ${err.message}` };
        }
      }

      // ─── Dynamic tool registry fallback ──────────────────
      // Check if this tool was registered at runtime via register_tool.
      // If it has an api_config, execute the HTTP call dynamically.
      const dynStart = Date.now();
      try {
        const dynamicResult = await executeDynamicTool(toolName, params);
        if (dynamicResult) {
          const dynLatency = Date.now() - dynStart;
          this.logToolCall(context.agentId, context.agentRole, toolName, params, dynamicResult, estimateToolCost(toolName));
          recordToolCall(toolName, 'dynamic_registry', dynamicResult.success, false, dynLatency)
            .catch(err => console.warn('[ToolReputation] tracking failed:', err));
          return dynamicResult;
        }
      } catch (dynErr) {
        const dynLatency = Date.now() - dynStart;
        recordToolCall(toolName, 'dynamic_registry', false, false, dynLatency)
          .catch(err => console.warn('[ToolReputation] tracking failed:', err));
        console.warn(`[ToolExecutor] Dynamic tool lookup failed for ${toolName}:`, (dynErr as Error).message);
      }

      return {
        success: false,
        error:
          `Unknown tool: ${toolName}. ` +
          'If this capability exists, call tool_search/list_my_tools and then request_tool_access with the exact tool name. ' +
          'If it does not exist, call request_new_tool and include suggested_api_config plus suggested_parameters so it can be auto-built immediately.',
        filesWritten: 0,
        memoryKeysWritten: 0,
      };
    }

    if (context.abortSignal.aborted) {
      return { success: false, error: 'Agent aborted before tool execution', filesWritten: 0, memoryKeysWritten: 0 };
    }

    const preflight = normalizeAndValidateToolParams(toolName, tool, params);
    if (preflight.error) {
      return {
        success: false,
        error: preflight.error,
        filesWritten: 0,
        memoryKeysWritten: 0,
      };
    }
    params = preflight.params;

    // ─── Enforcement checks ────────────────────────────────────
    if (this.enforcementEnabled) {
      const role = context.agentRole;
      const agentId = context.agentId;

      // 1. Emergency block check — is_blocked in agent_tool_grants
      const blocked = await isToolBlocked(role, toolName);
      if (blocked) {
        this.logSecurityEvent(agentId, role, toolName, 'TOOL_NOT_GRANTED', { reason: 'emergency_blocked' });
        return {
          success: false,
          error: `${toolName} is currently blocked for ${role}. Contact an admin to unblock.`,
          filesWritten: 0,
          memoryKeysWritten: 0,
        };
      }

      // 2. Rate limit check (default: 60 calls/hr per tool per agent)
      if (!this.checkRateLimit(role, toolName, 60)) {
        this.logSecurityEvent(agentId, role, toolName, 'RATE_LIMITED');
        return {
          success: false,
          error: `${role} rate limited on ${toolName}`,
          filesWritten: 0,
          memoryKeysWritten: 0,
        };
      }

      // 3. Budget check
      const estimatedCost = estimateToolCost(toolName);
      if (this.wouldExceedBudget(agentId, role, estimatedCost)) {
        this.logSecurityEvent(agentId, role, toolName, 'BUDGET_EXCEEDED');
        return {
          success: false,
          error: `${role} budget exceeded`,
          filesWritten: 0,
          memoryKeysWritten: 0,
        };
      }

      // Track costs
      this.runCosts.set(agentId, (this.runCosts.get(agentId) ?? 0) + estimatedCost);
      this.addDailyCost(role, estimatedCost);
      this.addMonthlyCost(role, estimatedCost);

      const runToolCounts = this.runToolCounts.get(agentId) ?? new Map<string, number>();
      const behaviorCheck = {
        agentId,
        agentRole: role,
        toolName,
        params,
        currentRunCostUsd: this.runCosts.get(agentId) ?? 0,
        currentRunToolCounts: runToolCounts,
      };
      const anomalies = detectBehavioralAnomalies(
        await loadBehaviorProfile(role),
        behaviorCheck,
      );
      if (anomalies.length > 0) {
        this.logSecurityEvent(agentId, role, toolName, 'BEHAVIORAL_ANOMALY', anomalies);
        await persistBehavioralAnomalies(behaviorCheck, anomalies);
        if (anomalies.some((anomaly) => anomaly.severity === 'high' || anomaly.severity === 'critical')) {
          void context.glyphorEventBus?.emit({
            type: 'alert.triggered',
            source: context.agentRole,
            priority: 'critical',
            payload: {
              category: 'behavioral_anomaly',
              tool_name: toolName,
              anomalies,
            },
          }).catch((err) => {
            console.warn('[ToolExecutor] Failed to emit behavioral anomaly alert:', (err as Error).message);
          });
        }
      }

      // 4. Formal budget verification for write tools
      if (this.formalVerifier && !isReadOnlyTool(toolName)) {
        const budget = AGENT_BUDGETS[role];
        if (budget) {
          const result = this.formalVerifier.verifyBudgetConstraint({
            proposedSpend: estimatedCost,
            currentSpend: this.runCosts.get(agentId) ?? 0,
            budgetLimit: budget.perRunUsd,
          });
          if (!result.passed) {
            this.logSecurityEvent(agentId, role, toolName, 'BUDGET_EXCEEDED', { formal: result.detail });
            return {
              success: false,
              error: `Formal verification failed: ${result.detail}`,
              filesWritten: 0,
              memoryKeysWritten: 0,
            };
          }
        }
      }
    }

    // ─── 5. Constitutional pre-check for high-stakes tools ────────
    // Wrapped in try/catch — pre-check failures must never prevent execution.
    let constitutionalCheckMeta: { checked: boolean; violations: number; blocked: boolean } | undefined;
    if (HIGH_STAKES_TOOLS.has(toolName)) {
      try {
        const governor = this.constitutionalGovernor;
        if (governor) {
          const constitution = await governor.getConstitution(context.agentRole);
          if (constitution) {
            const preCheck = await preCheckTool(
              context.agentRole,
              toolName,
              params,
              constitution,
              { redisCache: this.redisCache, modelClient: this.modelClient },
            );

            constitutionalCheckMeta = {
              checked: true,
              violations: preCheck.violations.length,
              blocked: !preCheck.allowed,
            };

            if (!preCheck.allowed) {
              this.logSecurityEvent(context.agentId, context.agentRole, toolName, 'CONSTITUTIONAL_BLOCK', {
                violations: preCheck.violations,
                duration_ms: preCheck.check_duration_ms,
              });
              return {
                success: false,
                error: `Constitutional pre-check blocked this action. Violations:\n${
                  preCheck.violations.map(v => `- [${v.severity}] ${v.principle_category}: ${v.description}`).join('\n')
                }\nRevise your approach to comply with your governing principles.`,
                filesWritten: 0,
                memoryKeysWritten: 0,
                constitutional_check: constitutionalCheckMeta,
              };
            }

            if (preCheck.violations.length > 0) {
              console.warn(`Constitutional warnings for ${context.agentRole}/${toolName}:`, preCheck.violations);
            }
          }
        }
      } catch (preCheckErr) {
        // Pre-check failure is non-blocking — log and proceed
        console.warn(`[ToolExecutor] Constitutional pre-check error for ${toolName}, proceeding:`, (preCheckErr as Error).message);
      }
    }

    // ─── 6. Data-evidence gate ─────────────────────────────────────
    // Tools in DATA_EVIDENCE_REQUIRED (e.g. create_decision, write_pipeline_report)
    // must be preceded by at least one successful data-sourcing tool call that
    // returned substantive (non-null, non-empty) data.  This prevents agents from
    // fabricating decisions or reports when no real data exists.
    if (DATA_EVIDENCE_REQUIRED.has(toolName)) {
      const agentDataCalls = this.callLog.filter(
        log => DATA_SOURCE_TOOLS.has(log.toolName) && log.agentId === context.agentId,
      );

      if (agentDataCalls.length === 0) {
        this.logSecurityEvent(context.agentId, context.agentRole, toolName, 'DATA_EVIDENCE_MISSING', {
          reason: 'No data-reading tools called before ' + toolName,
        });
        return {
          success: false,
          error: `${toolName} rejected: you must call at least one data-reading tool (${[...DATA_SOURCE_TOOLS].join(', ')}) before creating a decision or report. Decisions must be backed by verified data. If no data is available, report that status honestly instead.`,
          filesWritten: 0,
          memoryKeysWritten: 0,
        };
      }

      // Check if all data tool calls returned empty/null/"no data" responses
      const hasSubstantiveData = agentDataCalls.some(log => {
        if (!log.result.success) return false;
        const data = log.result.data;
        if (data == null) return false;
        if (typeof data === 'object' && data !== null && 'message' in (data as Record<string, unknown>)) {
          const msg = String((data as Record<string, unknown>).message).toLowerCase();
          if (msg.includes('no') && (msg.includes('data') || msg.includes('found'))) return false;
        }
        return true;
      });

      if (!hasSubstantiveData) {
        this.logSecurityEvent(context.agentId, context.agentRole, toolName, 'DATA_EVIDENCE_MISSING', {
          reason: 'All data tools returned empty/null — no substantive data to base decision on',
        });
        return {
          success: false,
          error: `${toolName} rejected: all data-reading tools returned empty or null data this run. There is no verified data to base this on. Report "no active pipeline" or "data not yet populated" instead of fabricating content.`,
          filesWritten: 0,
          memoryKeysWritten: 0,
        };
      }
    }

    // Dry-run mode: intercept mutative tools, allow read-only tools through
    if (this.dryRun && !isReadOnlyTool(toolName)) {
      console.log(`[DryRun] Would have executed: ${toolName}(${JSON.stringify(params)})`);
      return {
        success: true,
        data: {
          dryRun: true,
          wouldHaveExecuted: { name: toolName, args: params },
          message: `Dry-run mode: ${toolName} was not executed. In live mode this would have run with the provided arguments.`,
        },
        filesWritten: 0,
        memoryKeysWritten: 0,
      };
    }

    // ─── 7. Cross-agent verification for high-stakes actions ───────
    if (CROSS_AGENT_VERIFICATION_TOOLS.has(toolName) && this.verifierRunner) {
      const recentEvidence = this.callLog
        .filter((log) => log.agentId === context.agentId)
        .slice(-5)
        .map((log) =>
          `${log.toolName} -> ${log.result.success ? 'success' : 'error'}: ${
            typeof log.result.data === 'string'
              ? log.result.data
              : log.result.error ?? JSON.stringify(log.result.data ?? null)
          }`,
        )
        .join('\n');

      const verificationResult = await this.verifierRunner.verifyToolCall({
        primaryModel: 'gpt-5-mini-2025-08-07',
        agentRole: context.agentRole,
        toolName,
        toolParams: params,
        context: recentEvidence ? `Recent tool evidence:\n${recentEvidence}` : undefined,
      });

      if (verificationResult.verdict === 'BLOCK' || verificationResult.verdict === 'ESCALATE') {
        this.logSecurityEvent(context.agentId, context.agentRole, toolName, 'TOOL_VERIFICATION_BLOCK', {
          verdict: verificationResult.verdict,
          confidence: verificationResult.confidence,
          reasoning: verificationResult.reasoning,
          discrepancies: verificationResult.discrepancies,
          verifierModel: verificationResult.verifierModel,
        });
        return {
          success: false,
          error: `Tool call blocked by verification: ${verificationResult.reasoning}`,
          filesWritten: 0,
          memoryKeysWritten: 0,
        };
      }
    }

    const timeoutMs = VERY_LONG_RUNNING_TOOLS.has(toolName)
      ? VERY_LONG_TOOL_TIMEOUT_MS
      : LONG_RUNNING_TOOLS.has(toolName)
        ? LONG_TOOL_TIMEOUT_MS
        : DEFAULT_TOOL_TIMEOUT_MS;
    const toolSource = detectToolSource(toolName);
    const execStart = Date.now();

    try {
      const toolPromise = tool.execute(params, context);

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Tool ${toolName} timed out after ${timeoutMs}ms`)), timeoutMs),
      );

      const abortPromise = new Promise<never>((_, reject) => {
        if (context.abortSignal.aborted) {
          reject(new Error('Agent aborted'));
          return;
        }
        context.abortSignal.addEventListener(
          'abort',
          () => reject(new Error('Agent aborted')),
          { once: true },
        );
      });

      const result = await Promise.race([toolPromise, timeoutPromise, abortPromise]);

      const finalResult: ToolResult = {
        success: result.success,
        data: result.data,
        error: result.error,
        filesWritten: result.filesWritten ?? 0,
        memoryKeysWritten: result.memoryKeysWritten ?? 0,
        constitutional_check: constitutionalCheckMeta,
      };

      // Auto-verify mutations by reading back the written data
      if (isMutation(toolName) && finalResult.success) {
        const verifySpec = VERIFICATION_MAP[toolName];
        if (verifySpec && params[verifySpec.paramKey]) {
          try {
            const verifyResult = await this.execute(verifySpec.name, { [verifySpec.paramKey]: params[verifySpec.paramKey] }, context);
            const verifyData = verifyResult.success
              ? (typeof verifyResult.data === 'string' ? verifyResult.data : JSON.stringify(verifyResult.data))
              : `VERIFICATION FAILED: ${verifyResult.error}`;
            finalResult.data = typeof finalResult.data === 'object' && finalResult.data !== null
              ? { ...finalResult.data as Record<string, unknown>, _verification: verifyData }
              : { result: finalResult.data, _verification: verifyData };
          } catch (verifyErr) {
            console.warn(`[ToolExecutor] Verification failed for ${toolName}:`, (verifyErr as Error).message);
          }
        }
      }

      const runToolCounts = this.runToolCounts.get(context.agentId) ?? new Map<string, number>();
      runToolCounts.set(toolName, (runToolCounts.get(toolName) ?? 0) + 1);
      this.runToolCounts.set(context.agentId, runToolCounts);

      // Log the tool call
      this.logToolCall(
        context.agentId,
        context.agentRole,
        toolName,
        params,
        finalResult,
        estimateToolCost(toolName),
      );

      // Track repeated tool failures for auto-escalation
      if (!finalResult.success) {
        trackToolFailure(context.agentRole, toolName, finalResult.error ?? 'unknown error');
      }

      // Tool reputation tracking (fire-and-forget)
      const execLatency = Date.now() - execStart;
      recordToolCall(toolName, toolSource, finalResult.success, false, execLatency)
        .catch(err => console.warn('[ToolReputation] tracking failed:', err));

      // Persist tool call trace for eval analytics (fire-and-forget)
      const lastLog = this.callLog[this.callLog.length - 1];
      if (lastLog) {
        void persistToolCallTrace(
          lastLog,
          context.runId,
          context.assignmentId,
          context.turnNumber,
          context.retrievalMetadata?.get(toolName),
        );
      }

      return finalResult;
    } catch (error) {
      const failResult: ToolResult = {
        success: false,
        error: (error as Error).message,
        filesWritten: 0,
        memoryKeysWritten: 0,
      };

      this.logToolCall(
        context.agentId,
        context.agentRole,
        toolName,
        params,
        failResult,
        estimateToolCost(toolName),
      );

      trackToolFailure(context.agentRole, toolName, (error as Error).message);

      // Tool reputation tracking (fire-and-forget)
      const execLatency = Date.now() - execStart;
      const timedOut = (error as Error).message?.includes('timed out') || execLatency >= 60_000;
      recordToolCall(toolName, toolSource, false, timedOut, execLatency)
        .catch(err => console.warn('[ToolReputation] tracking failed:', err));

      // Persist tool call trace for eval analytics (fire-and-forget)
      const lastFailLog = this.callLog[this.callLog.length - 1];
      if (lastFailLog) {
        void persistToolCallTrace(
          lastFailLog,
          context.runId,
          context.assignmentId,
          context.turnNumber,
          context.retrievalMetadata?.get(toolName),
        );
      }

      return failResult;
    }
  }
}

// ─── Tool Failure Tracking & Auto-Escalation ──────────────────────
// When the same tool fails repeatedly (across any agent), log a
// diagnostic alert so CTO/ops can investigate the tool implementation.

interface ToolFailureRecord {
  agentRole: string;
  error: string;
  timestamp: number;
}

const toolFailureLog = new Map<string, ToolFailureRecord[]>();
const FAILURE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const FAILURE_ESCALATION_THRESHOLD = 3;    // 3 failures in the window
const escalatedTools = new Set<string>();  // prevent duplicate escalations per process

function trackToolFailure(agentRole: string, toolName: string, error: string): void {
  const now = Date.now();
  const records = toolFailureLog.get(toolName) ?? [];

  // Prune old entries
  const recent = records.filter(r => now - r.timestamp < FAILURE_WINDOW_MS);
  recent.push({ agentRole, error, timestamp: now });
  toolFailureLog.set(toolName, recent);

  // Check if we should escalate
  if (recent.length >= FAILURE_ESCALATION_THRESHOLD && !escalatedTools.has(toolName)) {
    escalatedTools.add(toolName);
    const uniqueAgents = [...new Set(recent.map(r => r.agentRole))];
    const uniqueErrors = [...new Set(recent.map(r => r.error.slice(0, 120)))];

    // Fire-and-forget: log to activity_log for CTO visibility
    systemQuery(
      `INSERT INTO activity_log (agent_role, agent_id, action, detail, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        'system',
        'tool-failure-tracker',
        'tool_repeated_failure',
        JSON.stringify({
          tool: toolName,
          failureCount: recent.length,
          affectedAgents: uniqueAgents,
          sampleErrors: uniqueErrors.slice(0, 3),
          window: '1h',
          recommendation: `Tool "${toolName}" has failed ${recent.length} times in the last hour across agents [${uniqueAgents.join(', ')}]. This likely indicates a code bug, not an agent error. CTO should investigate the tool implementation.`,
        }),
        new Date().toISOString(),
      ],
    ).catch(err => console.warn(`[ToolFailureTracker] Failed to log escalation:`, (err as Error).message));
  }
}
