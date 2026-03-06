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
  ToolContext,
  ToolResult,
  GeminiToolDeclaration,
  CompanyAgentRole,
  ToolCallLog,
  SecurityEvent,
  SecurityEventType,
} from './types.js';
import { AGENT_BUDGETS } from './types.js';
import { systemQuery } from '@glyphor/shared/db';
import type { FormalVerifier } from './formalVerifier.js';
import { executeDynamicTool } from './dynamicToolExecutor.js';

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

// Tools that are safe to execute in dry-run mode (read-only / computation)
const READ_ONLY_PREFIXES = ['get_', 'read_', 'calculate_', 'recall_', 'query_', 'search_', 'check_', 'fetch_', 'discover_', 'monitor_'];

function isReadOnlyTool(name: string): boolean {
  return READ_ONLY_PREFIXES.some((prefix) => name.startsWith(prefix));
}

// ─── MUTATION VERIFICATION ─────────────────────────────────────────
const MUTATION_PREFIXES = ['update_', 'create_', 'delete_', 'set_', 'assign_', 'grant_', 'revoke_', 'dispatch_'];

const isMutation = (toolName: string): boolean =>
  MUTATION_PREFIXES.some(p => toolName.startsWith(p));

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
  private dailyCosts: Map<string, number> = new Map();   // role → cumulative cost today
  private monthlyCosts: Map<string, number> = new Map(); // role → cumulative cost this month
  private enforcementEnabled: boolean;
  private formalVerifier: FormalVerifier | null;

  constructor(tools: ToolDefinition[], dryRun = false, enforcement = true, formalVerifier?: FormalVerifier) {
    this.tools = new Map(tools.map((t) => [t.name, t]));
    this.dryRun = dryRun;
    this.enforcementEnabled = enforcement;
    this.formalVerifier = formalVerifier ?? null;
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

  getDeclarations(): GeminiToolDeclaration[] {
    return Array.from(this.tools.values()).map((t): GeminiToolDeclaration => {
      const required = Object.entries(t.parameters)
        .filter(([, v]) => v.required)
        .map(([k]) => k);

      const params: GeminiToolDeclaration['parameters'] = {
        type: 'object',
        properties: Object.fromEntries(
          Object.entries(t.parameters).map(([k, v]) => [
            k,
            {
              type: v.type,
              description: v.description,
              ...(v.enum ? { enum: v.enum } : {}),
              // Gemini API requires items for array types — default to string if missing
              ...(v.type === 'array'
                ? { items: v.items ?? { type: 'string' } }
                : v.items ? { items: v.items } : {}),
              ...(v.properties ? { properties: v.properties } : {}),
            },
          ]),
        ),
      };

      // Gemini rejects an empty required array — omit the field when no parameters are required.
      if (required.length > 0) params.required = required;

      return { name: t.name, description: t.description, parameters: params };
    });
  }

  async execute(
    toolName: string,
    params: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      // ─── Runtime tool routing ──────────────────────────────
      // Tools created mid-run via RuntimeToolFactory are prefixed
      // with 'runtime_' and executed through the factory.
      if (toolName.startsWith('runtime_') && context.runtimeToolFactory) {
        try {
          const result = await context.runtimeToolFactory.execute(toolName, params as Record<string, any>);
          return { success: true, data: result };
        } catch (err: any) {
          return { success: false, error: `Runtime tool error: ${err.message}` };
        }
      }

      // ─── Dynamic tool registry fallback ──────────────────
      // Check if this tool was registered at runtime via register_tool.
      // If it has an api_config, execute the HTTP call dynamically.
      try {
        const dynamicResult = await executeDynamicTool(toolName, params);
        if (dynamicResult) {
          this.logToolCall(context.agentId, context.agentRole, toolName, params, dynamicResult, estimateToolCost(toolName));
          return dynamicResult;
        }
      } catch (dynErr) {
        console.warn(`[ToolExecutor] Dynamic tool lookup failed for ${toolName}:`, (dynErr as Error).message);
      }

      return { success: false, error: `Unknown tool: ${toolName}`, filesWritten: 0, memoryKeysWritten: 0 };
    }

    if (context.abortSignal.aborted) {
      return { success: false, error: 'Agent aborted before tool execution', filesWritten: 0, memoryKeysWritten: 0 };
    }

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

    // ─── 5. Data-evidence gate ─────────────────────────────────────
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

    const timeoutMs = LONG_RUNNING_TOOLS.has(toolName) ? LONG_TOOL_TIMEOUT_MS : DEFAULT_TOOL_TIMEOUT_MS;

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
