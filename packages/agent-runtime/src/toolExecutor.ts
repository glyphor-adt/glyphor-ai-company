/**
 * Tool Executor — Manages tool set and dispatches tool calls
 *
 * Enforces per-agent tool grants, scope checking, rate limiting,
 * budget caps, and logs all tool calls + security events.
 *
 * Dynamic grants: Sarah (Chief of Staff) can temporarily grant existing
 * tools to agents via the agent_tool_grants table. Grants are cached
 * for 60 seconds to avoid per-call DB queries.
 */

import type {
  ToolDefinition,
  ToolContext,
  ToolResult,
  GeminiToolDeclaration,
  CompanyAgentRole,
  ToolGrant,
  ToolCallLog,
  SecurityEvent,
  SecurityEventType,
} from './types.js';
import { AGENT_BUDGETS } from './types.js';
import type { SupabaseClient } from '@supabase/supabase-js';

// ─── DB Grant Cache ────────────────────────────────────────────
const GRANT_CACHE_TTL_MS = 60_000; // 60 seconds

interface GrantCacheEntry {
  toolNames: Set<string>;
  fetchedAt: number;
}

const grantCache = new Map<string, GrantCacheEntry>(); // role → cache entry

/**
 * Check if a tool is granted to an agent via the DB (agent_tool_grants table).
 * Results are cached for 60s per role to avoid per-call DB queries.
 */
export async function isToolGranted(
  agentRole: CompanyAgentRole,
  toolName: string,
  supabase: SupabaseClient,
): Promise<boolean> {
  const now = Date.now();
  const cached = grantCache.get(agentRole);

  if (cached && now - cached.fetchedAt < GRANT_CACHE_TTL_MS) {
    return cached.toolNames.has(toolName);
  }

  // Cache miss — fetch from DB
  const { data, error } = await supabase
    .from('agent_tool_grants')
    .select('tool_name')
    .eq('agent_role', agentRole)
    .eq('is_active', true)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);

  if (error) {
    console.warn(`[ToolGrants] Failed to fetch grants for ${agentRole}:`, error.message);
    // On DB error, allow the tool (fail-open for availability)
    return true;
  }

  const toolNames = new Set((data ?? []).map((row: { tool_name: string }) => row.tool_name));
  grantCache.set(agentRole, { toolNames, fetchedAt: now });

  return toolNames.has(toolName);
}

/** Invalidate the grant cache for a role (called after grant/revoke). */
export function invalidateGrantCache(agentRole?: string): void {
  if (agentRole) {
    grantCache.delete(agentRole);
  } else {
    grantCache.clear();
  }
}

/**
 * Load all granted tool names for an agent from the DB.
 * Used to check what tools an agent has access to (for system prompt injection).
 */
export async function loadGrantedToolNames(
  agentRole: CompanyAgentRole,
  supabase: SupabaseClient,
): Promise<string[]> {
  const now = Date.now();
  const cached = grantCache.get(agentRole);

  if (cached && now - cached.fetchedAt < GRANT_CACHE_TTL_MS) {
    return Array.from(cached.toolNames);
  }

  const { data, error } = await supabase
    .from('agent_tool_grants')
    .select('tool_name')
    .eq('agent_role', agentRole)
    .eq('is_active', true)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);

  if (error) {
    console.warn(`[ToolGrants] Failed to load grants for ${agentRole}:`, error.message);
    return [];
  }

  const toolNames = new Set((data ?? []).map((row: { tool_name: string }) => row.tool_name));
  grantCache.set(agentRole, { toolNames, fetchedAt: now });

  return Array.from(toolNames);
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
  private toolGrants: Map<string, Map<string, ToolGrant>> = new Map(); // role → toolName → grant
  private callLog: ToolCallLog[] = [];
  private securityLog: SecurityEvent[] = [];
  private rateCounts: Map<string, number[]> = new Map(); // "role:tool" → timestamps
  private runCosts: Map<string, number> = new Map();     // agentId → cumulative cost this run
  private dailyCosts: Map<string, number> = new Map();   // role → cumulative cost today
  private monthlyCosts: Map<string, number> = new Map(); // role → cumulative cost this month
  private enforcementEnabled: boolean;
  private supabase: SupabaseClient | null;

  constructor(tools: ToolDefinition[], dryRun = false, enforcement = true, supabase?: SupabaseClient) {
    this.tools = new Map(tools.map((t) => [t.name, t]));
    this.dryRun = dryRun;
    this.enforcementEnabled = enforcement;
    this.supabase = supabase ?? null;
  }

  // ─── Tool Grant Registration ──────────────────────────────────

  registerGrants(role: CompanyAgentRole, grants: ToolGrant[]): void {
    const roleGrants = new Map<string, ToolGrant>();
    for (const grant of grants) {
      roleGrants.set(grant.toolName, grant);
    }
    this.toolGrants.set(role, roleGrants);
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
      return { success: false, error: `Unknown tool: ${toolName}`, filesWritten: 0, memoryKeysWritten: 0 };
    }

    if (context.abortSignal.aborted) {
      return { success: false, error: 'Agent aborted before tool execution', filesWritten: 0, memoryKeysWritten: 0 };
    }

    // ─── Enforcement checks ────────────────────────────────────
    if (this.enforcementEnabled) {
      const role = context.agentRole;
      const agentId = context.agentId;

      // 1. Tool grant check — hardcoded grants (if registered) OR DB grants
      const roleGrants = this.toolGrants.get(role);
      if (roleGrants && !roleGrants.has(toolName)) {
        // Hardcoded grants exist and tool is not in them
        this.logSecurityEvent(agentId, role, toolName, 'TOOL_NOT_GRANTED');
        return {
          success: false,
          error: `${role} does not have access to ${toolName}`,
          filesWritten: 0,
          memoryKeysWritten: 0,
        };
      } else if (!roleGrants && this.supabase) {
        // No hardcoded grants — check DB grants
        const granted = await isToolGranted(role, toolName, this.supabase);
        if (!granted) {
          this.logSecurityEvent(agentId, role, toolName, 'TOOL_NOT_GRANTED');
          return {
            success: false,
            error: `${role} does not have access to ${toolName}`,
            filesWritten: 0,
            memoryKeysWritten: 0,
          };
        }
      }

      const grant = roleGrants?.get(toolName);

      // 2. Scope check
      if (grant?.scope) {
        for (const [scopeKey, scopeValue] of Object.entries(grant.scope)) {
          const argValue = params[scopeKey];
          if (argValue !== undefined && scopeValue !== undefined) {
            const scopeStr = String(scopeValue);
            const argStr = String(argValue);
            // Support wildcard scope patterns (e.g., "test/*")
            if (scopeStr.includes('*')) {
              const pattern = new RegExp('^' + scopeStr.replace(/\*/g, '.*') + '$');
              if (!pattern.test(argStr)) {
                this.logSecurityEvent(agentId, role, toolName, 'SCOPE_VIOLATION', { scopeKey, expected: scopeStr, actual: argStr });
                return {
                  success: false,
                  error: `${role} called ${toolName} outside scope: ${scopeKey}=${argStr} (allowed: ${scopeStr})`,
                  filesWritten: 0,
                  memoryKeysWritten: 0,
                };
              }
            }
          }
        }
      }

      // 3. Rate limit check
      if (grant?.rateLimit) {
        if (!this.checkRateLimit(role, toolName, grant.rateLimit)) {
          this.logSecurityEvent(agentId, role, toolName, 'RATE_LIMITED');
          return {
            success: false,
            error: `${role} rate limited on ${toolName}`,
            filesWritten: 0,
            memoryKeysWritten: 0,
          };
        }
      }

      // 4. Budget check
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

      // Log the tool call
      this.logToolCall(
        context.agentId,
        context.agentRole,
        toolName,
        params,
        finalResult,
        estimateToolCost(toolName),
      );

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

      return failResult;
    }
  }
}
