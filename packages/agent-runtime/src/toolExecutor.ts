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
import { AGENT_BUDGETS, WRITE_TOOLS as WRITE_TOOL_SET } from './types.js';
import { systemQuery } from '@glyphor/shared/db';
import { buildSearchableToolDescription } from './toolRegistry.js';
import type { FormalVerifier } from './formalVerifier.js';
import { executeDynamicTool } from './dynamicToolExecutor.js';
import { abacMiddleware } from './abac.js';
import { HIGH_STAKES_TOOLS, preCheckTool } from './constitutionalPreCheck.js';
import type { ConstitutionalGovernor } from './constitutionalGovernor.js';
import type { ModelClient } from './modelClient.js';
import { VerifierRunner } from './verifierRunner.js';
import type { RedisCache } from './redisCache.js';
import { enforceCapacityTier, executeCommitment, getTierModel, type CapacityEnforcementAction } from '@glyphor/shared';
import { recordToolCall, detectToolSource } from './toolReputationTracker.js';
import { applyPatchToGitHub } from './patchHarness.js';
import { extractPredictionRecords, persistPredictionRecords } from './predictionJournal.js';
import {
  DisclosureRequiredError,
  applyDisclosurePolicy,
  inferRecipientTypeFromEmails,
  isExternalCommitment,
} from './disclosure.js';
import {
  detectBehavioralAnomalies,
  loadBehaviorProfile,
  persistBehavioralAnomalies,
} from './behavioralFingerprint.js';
import { classifyActionRisk } from './actionRiskClassifier.js';
import type { CommunicationType, RecipientType } from './types.js';
import { createToolHookRunnerFromEnv, type ToolHookRunner, CompositeHookRunner, createCompositeHookRunner } from './hooks/hookRunner.js';
import { shouldBlockToolCall } from './circuitBreaker.js';
import { checkToolPolicy, type PolicyLimitsCache } from './policyLimits.js';
import {
  type DenialTrackingState,
  type DenialSource,
  type EscalationDecision,
  createInitialState as createDenialState,
  recordDenial,
  recordSuccess,
  markEscalated,
  shouldEscalate,
  evaluateEscalation,
  isToolRunBlocked,
  getDenialSummary,
} from './denialTracking.js';
import { isSafeTool, getToolMeta, isToolPermittedForRole, type SafeToolDefinition } from './buildTool.js';
import { startTraceSpan } from './telemetry/tracing.js';
import {
  recordEvidence,
  recordRunEvent,
  linkClaimToEvidence,
  createEvidenceSourceRef,
} from './telemetry/runLedger.js';

// ─── Tool Call Trace Persistence ───────────────────────────────
// Fire-and-forget write of each tool call to tool_call_traces for
// eval and retrieval analytics. Never throws.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeTraceRunId(runId: string | undefined): string | null {
  if (!runId || !UUID_RE.test(runId)) return null;
  return runId;
}

async function persistToolCallTrace(
  log: ToolCallLog,
  runId: string | undefined,
  assignmentId: string | undefined,
  turnNumber: number,
  retrievalMeta?: ToolRetrievalMeta,
): Promise<void> {
  const safeRunId = normalizeTraceRunId(runId);
  if (!safeRunId) return;
  try {
    await systemQuery(
      `INSERT INTO tool_call_traces
       (run_id, assignment_id, agent_id, agent_role, tool_name, args,
        result_success, result_data, result_error, files_written, memory_keys_written,
        constitutional_check, estimated_cost_usd, risk_level, turn_number,
        retrieval_method, retrieval_score, tools_available, model_cap)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [
        safeRunId,
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
        log.riskLevel,
        turnNumber,
        retrievalMeta?.method ?? null,
        retrievalMeta?.score ?? null,
        retrievalMeta?.toolsAvailable ?? null,
        retrievalMeta?.modelCap ?? null,
      ],
    );
  } catch (err) {
    console.error('[persistToolCallTrace] INSERT failed', {
      agentId: log.agentId,
      toolName: log.toolName,
      runId: safeRunId,
      error: String(err),
    });
  }
}

async function persistToolActivityLog(
  toolName: string,
  params: Record<string, unknown>,
  result: ToolResult,
  context: ToolContext,
): Promise<string | null> {
  const summary = result.success
    ? `${context.agentRole} executed ${toolName}`
    : `${context.agentRole} attempted ${toolName}: ${result.error ?? 'failed'}`;

  const details = {
    tool_name: toolName,
    tool_args: params,
    run_id: context.runId ?? null,
    task_id: context.assignmentId ?? context.runId ?? null,
    result_success: result.success,
    result_error: result.error ?? null,
    risk_level: result.riskLevel ?? null,
    approval_required: result.approvalRequired ?? false,
    approval_reason: result.approvalReason ?? null,
    registry_entry_id: result.registryEntryId ?? null,
  };

  try {
    const rows = await systemQuery<{ id: string }>(
      `INSERT INTO activity_log (
         agent_role,
         agent_id,
         action,
         activity_type,
         summary,
         description,
         details,
         created_at
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
       RETURNING id`,
      [
        context.agentRole,
        context.agentRole,
        toolName,
        'decision_trace',
        summary,
        result.success ? null : (result.error ?? null),
        JSON.stringify(details),
        new Date().toISOString(),
      ],
    );
    return rows[0]?.id ?? null;
  } catch (err) {
    console.warn(`[ToolExecutor] Failed to write activity log for ${toolName}:`, (err as Error).message);
    return null;
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
/** Web pipeline can spend ~5m polling Vercel preview alone; plus foundation LLM + GitHub. Override via TOOL_VERY_LONG_TIMEOUT_MS. */
const VERY_LONG_TOOL_TIMEOUT_MS = Math.max(60_000, Number(process.env.TOOL_VERY_LONG_TIMEOUT_MS ?? '900000'));
/** Single-shot HTML demo runs an LLM inside the tool; default 5m. Override via TOOL_QUICK_DEMO_TIMEOUT_MS. */
const QUICK_DEMO_TOOL_TIMEOUT_MS = Math.max(60_000, Number(process.env.TOOL_QUICK_DEMO_TIMEOUT_MS ?? '300000'));
const QUICK_DEMO_TOOLS = new Set(['quick_demo_web_app']);

// Company tools that legitimately take longer (API calls, report generation).
// MCP tools hit Cloud Run services with scale-to-zero — cold start alone can
// consume 5-10s, so they need at least 120s total budget.
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
  'generate_pdf',
  'run_lighthouse_audit',
  'send_briefing',
]);

// MCP tool prefix patterns — any tool starting with these gets LONG timeout
// to account for Cloud Run cold starts + network round-trip.
const MCP_TOOL_PREFIXES = ['mcp_', 'glyphor_', 'a365_'];
function isMcpTool(name: string): boolean {
  return MCP_TOOL_PREFIXES.some(p => name.startsWith(p));
}

const VERY_LONG_RUNNING_TOOLS = new Set([
  'invoke_web_build',
  'invoke_web_iterate',
  'invoke_web_upgrade',
  'invoke_web_coding_loop',
  'build_website_foundation',
  'normalize_design_brief',
]);

// Tools that are safe to execute in dry-run mode (read-only / computation)
const READ_ONLY_PREFIXES = ['get_', 'read_', 'calculate_', 'recall_', 'query_', 'search_', 'check_', 'fetch_', 'discover_', 'monitor_'];

function isReadOnlyTool(name: string): boolean {
  return READ_ONLY_PREFIXES.some((prefix) => name.startsWith(prefix));
}

function extractCounterparty(params: Record<string, unknown>): string | null {
  const candidateKeys = [
    'externalCounterparty', 'counterparty', 'vendor', 'customer', 'recipient', 'to',
    'email', 'organization', 'company', 'channel', 'platform', 'target',
  ];

  for (const key of candidateKeys) {
    const value = params[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

function extractEstimatedValue(params: Record<string, unknown>): string | number | null {
  const candidateKeys = ['estimatedValue', 'estimated_value', 'amount', 'value', 'cost', 'budget', 'payment_amount'];
  for (const key of candidateKeys) {
    const value = params[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return null;
}

function buildCapacityAction(toolName: string, params: Record<string, unknown>): CapacityEnforcementAction {
  return {
    type: toolName,
    toolCall: { name: toolName, input: params },
    externalCounterparty: extractCounterparty(params),
    estimatedValue: extractEstimatedValue(params),
    requiresExternalCommitment: isExternalCommitment({ toolName, params }),
    actionDescription: `Tool call ${toolName}`,
  };
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

// Map from full GitHub repo names to their short enum key equivalents.
// Add a new entry here whenever a new repo is registered in GLYPHOR_REPOS
// (packages/integrations/src/github/index.ts) and exposed via a tool parameter.
const REPO_NAME_TO_KEY: Record<string, string> = {
  'glyphor-ai-company': 'company',
};

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

  // Normalize GitHub repo full names to their short key equivalents.
  // Agents sometimes pass the full GitHub repo name (e.g. 'glyphor-ai-company')
  // instead of the tool-expected enum key (e.g. 'company'). Only applies when
  // the repo parameter has an enum and the raw value is not already a valid key.
  // To support a new repo, add it to REPO_NAME_TO_KEY above.
  if (typeof params.repo === 'string') {
    const repoSpec = tool.parameters['repo'];
    if (repoSpec?.enum && repoSpec.enum.length > 0 && !repoSpec.enum.includes(params.repo)) {
      const normalized = REPO_NAME_TO_KEY[params.repo];
      if (normalized !== undefined && repoSpec.enum.includes(normalized)) {
        params.repo = normalized;
      }
    }
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
  'submit_assignment_output',
  'send_dm',
  'send_teams_dm',
  'create_calendar_event',
  'evaluate_calendar_mcp_founder_create_event',
  'CreateEvent',
  'mcp_CalendarTools.CreateEvent',
  'mcp_CalendarTools/CreateEvent',
  'revoke_tool_access',
]);

// ─── DATA-EVIDENCE GATE ────────────────────────────────────────
// Tools that MUST have prior data-sourcing tool calls with substantive
// data before they can execute.  Prevents agents from fabricating
// decisions or reports based on hallucinated data.
const DATA_EVIDENCE_REQUIRED = new Set([
  'create_decision',
  'write_pipeline_report',
  'create_status_report',   // report must reflect real state, not invented summaries
  'create_research_brief',  // research brief should synthesise real data, not hallucinate
]);

/** Tools considered valid data sources for the evidence gate. */
const DATA_SOURCE_TOOLS = new Set([
  // Financial / metrics
  'get_product_metrics',
  'get_financials',
  'get_burn_rate',
  'get_cash_balance',
  'get_cash_flow',
  'get_ai_model_costs',
  'query_stripe_mrr',
  'query_stripe_subscriptions',
  // Company state
  'get_company_vitals',
  'get_recent_activity',
  'read_company_memory',
  'get_data_freshness',
  // Customer / growth
  'get_churn_analysis',
  'get_customer_ltv',
  'get_cohort_retention',
  'get_attribution_data',
  'get_content_metrics',
  // Competitive / product
  'get_competitor_profile',
  'get_roadmap',
  'get_component_info',
]);

/** Maps mutation tools to their read counterpart for post-write verification.
 * paramKey='' means "no param required" — readback fires unconditionally on success. */
const VERIFICATION_MAP: Record<string, { name: string; paramKey: string }> = {
  'update_agent_profile':      { name: 'get_agent_profile',      paramKey: 'agent_role' },
  'update_company_knowledge':  { name: 'get_company_knowledge',  paramKey: 'id' },
  'update_competitor_profile': { name: 'get_competitor_profile', paramKey: 'company_name' },
  'update_company_vitals':     { name: 'get_company_vitals',     paramKey: '' },
  'update_roadmap_item':       { name: 'get_roadmap',            paramKey: '' },
  'update_doctrine_section':   { name: 'read_company_doctrine',  paramKey: '' },
};

/** Rough cost estimate per tool call in USD */
function estimateToolCost(toolName: string): number {
  if (isReadOnlyTool(toolName)) return 0.001;
  if (VERY_LONG_RUNNING_TOOLS.has(toolName)) return 0.02;
  if (QUICK_DEMO_TOOLS.has(toolName)) return 0.015;
  if (LONG_RUNNING_TOOLS.has(toolName)) return 0.01;
  return 0.003;
}

const VALUE_GATE_RATIO_THRESHOLD = Number(process.env.TOOL_VALUE_GATE_RATIO_THRESHOLD ?? '2.5');
const VALUE_GATE_CONFIDENCE_THRESHOLD = Number(process.env.TOOL_VALUE_GATE_CONFIDENCE_THRESHOLD ?? '0.6');
/** When `enforce`, apply the pre-execution value gate to dashboard/chat (`on_demand`) too. Default: skip gate for chat — user opened the session, same trust model as interactive coding agents. */
const VALUE_GATE_ENFORCE_ON_DEMAND = process.env.TOOL_VALUE_GATE_ON_DEMAND === 'enforce';
const TOOL_RETRY_CAP = Math.max(1, Number(process.env.TOOL_RETRY_CAP ?? '5'));

/** Patterns that indicate a transient error worth retrying at the tool level. */
const TRANSIENT_TOOL_ERROR = /\b(ECONNREFUSED|ECONNRESET|ETIMEDOUT|EPIPE|connection.*(?:terminated|refused|reset|timeout|lost)|too many clients|remaining connection slots|cannot acquire|lock timeout|deadlock|could not serialize|server closed the connection|Client has encountered a connection error|canceling statement due to statement timeout)\b/i;
const MAX_TOOL_TRANSIENT_RETRIES = 2;
const TOOL_TRANSIENT_BASE_DELAY_MS = 800;

function estimateTPlus1Impact(toolName: string): number {
  if (toolName.startsWith('send_') || toolName.startsWith('publish_')) return 0.9;
  if (toolName.startsWith('create_') || toolName.startsWith('update_') || toolName.startsWith('delete_')) return 0.75;
  if (toolName.startsWith('request_') || toolName.startsWith('dispatch_')) return 0.6;
  return 0.4;
}

function estimateFunctionScore(toolName: string, params: Record<string, unknown>): number {
  const objective = typeof params.objective === 'string' ? params.objective.trim() : '';
  const hasRichObjective = objective.length >= 20;
  const hasIds = typeof params.assignment_id === 'string' || typeof params.directive_id === 'string';
  const writeBoost = WRITE_TOOL_SET.has(toolName) ? 0.25 : 0.1;
  const objectiveBoost = hasRichObjective ? 0.25 : 0;
  const idBoost = hasIds ? 0.2 : 0;
  return Math.min(1, 0.3 + writeBoost + objectiveBoost + idBoost);
}

function estimateConfidence(params: Record<string, unknown>, context: ToolContext): number {
  let confidence = 0.4;
  if (context.assignmentId) confidence += 0.2;
  if (context.directiveId) confidence += 0.15;
  // Interactive chat: user explicitly invoked the agent — sufficient intent for substantive tools
  // (otherwise confidence stays at 0.4 and TOOL_VALUE_GATE_CONFIDENCE_THRESHOLD 0.6 blocks everything).
  if (context.requestSource === 'on_demand') confidence += 0.25;
  if (typeof params.reason === 'string' && params.reason.trim().length > 10) confidence += 0.15;
  if (typeof params.evidence === 'string' && params.evidence.trim().length > 10) confidence += 0.1;
  return Math.min(1, confidence);
}

function evaluateActionValue(
  toolName: string,
  params: Record<string, unknown>,
  estimatedCost: number,
  context: ToolContext,
): {
  functionScore: number;
  confidence: number;
  tPlus1Impact: number;
  valueRatio: number;
  allow: boolean;
} {
  const functionScore = estimateFunctionScore(toolName, params);
  const confidence = estimateConfidence(params, context);
  const tPlus1Impact = estimateTPlus1Impact(toolName);
  const valueRatio = ((functionScore * 0.5) + (confidence * 0.25) + (tPlus1Impact * 0.25)) / Math.max(estimatedCost, 0.0001);
  const allow = valueRatio >= VALUE_GATE_RATIO_THRESHOLD && confidence >= VALUE_GATE_CONFIDENCE_THRESHOLD;
  return { functionScore, confidence, tPlus1Impact, valueRatio, allow };
}

function hasContextScopeMismatch(params: Record<string, unknown>, context: ToolContext): string | null {
  if (typeof params.assignment_id === 'string' && context.assignmentId && params.assignment_id !== context.assignmentId) {
    return `assignment_id mismatch: expected ${context.assignmentId}, got ${params.assignment_id}`;
  }
  if (typeof params.directive_id === 'string' && context.directiveId && params.directive_id !== context.directiveId) {
    return `directive_id mismatch: expected ${context.directiveId}, got ${params.directive_id}`;
  }
  return null;
}

function hasSubstantiveData(data: unknown): boolean {
  if (data == null) return false;
  if (typeof data === 'string') return data.trim().length > 0;
  if (Array.isArray(data)) return data.length > 0;
  if (typeof data === 'object') return Object.keys(data as Record<string, unknown>).length > 0;
  return true;
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
  private runToolFailures: Map<string, Map<string, number>> = new Map(); // agentId → per-tool failures this run
  private dailyCosts: Map<string, number> = new Map();   // role → cumulative cost today
  private monthlyCosts: Map<string, number> = new Map(); // role → cumulative cost this month
  private enforcementEnabled: boolean;
  private formalVerifier: FormalVerifier | null;
  private constitutionalGovernor: ConstitutionalGovernor | null = null;
  private modelClient: ModelClient | null = null;
  private redisCache: RedisCache | null = null;
  private verifierRunner: VerifierRunner | null = null;
  private compositeHookRunner: CompositeHookRunner;
  private denialState: DenialTrackingState = createDenialState();
  private policyCache: PolicyLimitsCache | null = null;

  constructor(tools: ToolDefinition[], dryRun = false, enforcement = true, formalVerifier?: FormalVerifier) {
    this.tools = new Map(tools.map((t) => [t.name, t]));
    this.dryRun = dryRun;
    this.enforcementEnabled = enforcement;
    this.formalVerifier = formalVerifier ?? null;
    this.compositeHookRunner = createCompositeHookRunner(createToolHookRunnerFromEnv());
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

  /** Inject a custom hook runner (primarily for tests). */
  setToolHookRunner(runner: ToolHookRunner | null): void {
    this.compositeHookRunner = createCompositeHookRunner(runner);
  }

  /** Attach the policy limits cache for per-agent feature gating. */
  setPolicyCache(cache: PolicyLimitsCache | null): void {
    this.policyCache = cache;
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

  /** Get the current denial tracking state for diagnostics. */
  getDenialState(): DenialTrackingState {
    return this.denialState;
  }

  /** Get a human-readable denial tracking summary. */
  getDenialSummary(): string {
    return getDenialSummary(this.denialState);
  }

  /** Reset denial tracking (e.g., between runs for the same executor instance). */
  resetDenialTracking(): void {
    this.denialState = createDenialState();
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
    riskLevel: ToolCallLog['riskLevel'],
  ): void {
    this.callLog.push({
      agentId,
      agentRole,
      toolName,
      args,
      result,
      estimatedCostUsd: costUsd,
      riskLevel,
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

    const riskAssessment = classifyActionRisk(toolName);
    void recordRunEvent({
      runId: context.runId,
      eventType: 'tool.requested',
      trigger: 'tool.execute',
      component: 'toolExecutor',
      payload: {
        tool_name: toolName,
        turn_number: context.turnNumber,
        risk_level: riskAssessment.level,
      },
    });

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
          return { success: true, data: result, riskLevel: riskAssessment.level };
        } catch (err: any) {
          const rtLatency = Date.now() - rtStart;
          const rtTimedOut = err.message?.includes('timeout') || rtLatency >= 60_000;
          recordToolCall(toolName, 'runtime', false, rtTimedOut, rtLatency)
            .catch(e => console.warn('[ToolReputation] tracking failed:', e));
          return { success: false, error: `Runtime tool error: ${err.message}`, riskLevel: riskAssessment.level };
        }
      }

      // ─── Dynamic tool registry fallback ──────────────────
      // Check if this tool was registered at runtime via register_tool.
      // If it has an api_config, execute the HTTP call dynamically.
      const dynStart = Date.now();
      try {
        const dynamicResult = await executeDynamicTool(toolName, params, this.tools);
        if (dynamicResult) {
          const dynLatency = Date.now() - dynStart;
          const classifiedDynamicResult: ToolResult = {
            ...dynamicResult,
            riskLevel: riskAssessment.level,
          };
          this.logToolCall(
            context.agentId,
            context.agentRole,
            toolName,
            params,
            classifiedDynamicResult,
            estimateToolCost(toolName),
            riskAssessment.level,
          );
          recordToolCall(toolName, 'dynamic_registry', dynamicResult.success, false, dynLatency)
            .catch(err => console.warn('[ToolReputation] tracking failed:', err));
          return classifiedDynamicResult;
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
        riskLevel: riskAssessment.level,
      };
    }

    if (context.abortSignal.aborted) {
      return {
        success: false,
        error: 'Agent aborted before tool execution',
        filesWritten: 0,
        memoryKeysWritten: 0,
        riskLevel: riskAssessment.level,
      };
    }

    // ─── Planning phase gate: read-only enforcement ────────
    // When the agent is in the planning phase, only read-only tools are
    // permitted. This prevents side effects during plan decomposition,
    // even if the model somehow emits a tool call (tools are stripped from
    // declarations during planning, but this is defense-in-depth).
    if (context.runPhase === 'planning' && !isReadOnlyTool(toolName)) {
      this.logSecurityEvent(context.agentId, context.agentRole, toolName, 'POLICY_BLOCKED', {
        reason: 'planning_phase_read_only',
        message: `Tool "${toolName}" blocked during planning phase. Only read-only tools are allowed.`,
      });
      return {
        success: false,
        error: `Tool "${toolName}" is blocked during the planning phase. Only read-only tools (get_*, read_*, calculate_*, recall_*, query_*, search_*, check_*, fetch_*, discover_*, monitor_*) are permitted. Complete your plan first, then tools will be available during the execution phase.`,
        filesWritten: 0,
        memoryKeysWritten: 0,
        riskLevel: riskAssessment.level,
      };
    }

    // ─── Circuit breaker: global fleet halt gate ─────────
    // Check if the fleet-wide circuit breaker is tripped.
    // This runs before all other gates — if the fleet is halted, nothing runs.
    const haltCheck = await shouldBlockToolCall(toolName, context.agentRole);
    if (haltCheck.blocked) {
      this.logSecurityEvent(context.agentId, context.agentRole, toolName, 'RATE_LIMITED', {
        reason: 'global_circuit_breaker',
        message: haltCheck.message,
      });
      return {
        success: false,
        error: haltCheck.message,
        filesWritten: 0,
        memoryKeysWritten: 0,
        riskLevel: riskAssessment.level,
      };
    }

    // ─── Circuit breaker: denial tracking gate ──────────────
    // Check if this tool or the entire run is blocked by accumulated denials.
    if (isToolRunBlocked(this.denialState, toolName)) {
      const escalation = evaluateEscalation(this.denialState, toolName);
      this.logSecurityEvent(context.agentId, context.agentRole, toolName, 'RATE_LIMITED', {
        reason: 'denial_circuit_breaker',
        escalation_action: escalation.action,
        denial_summary: getDenialSummary(this.denialState),
      });
      return {
        success: false,
        error: escalation.agentMessage,
        filesWritten: 0,
        memoryKeysWritten: 0,
        riskLevel: riskAssessment.level,
      };
    }
    if (shouldEscalate(this.denialState)) {
      const escalation = evaluateEscalation(this.denialState, toolName);
      if (escalation.action === 'abort_run' || escalation.action === 'abort_tool') {
        this.denialState = markEscalated(this.denialState, escalation.reason);
        this.logSecurityEvent(context.agentId, context.agentRole, toolName, 'RATE_LIMITED', {
          reason: 'denial_circuit_breaker_escalated',
          escalation_action: escalation.action,
          denial_summary: getDenialSummary(this.denialState),
        });
        return {
          success: false,
          error: escalation.agentMessage,
          filesWritten: 0,
          memoryKeysWritten: 0,
          riskLevel: riskAssessment.level,
        };
      }
    }

    // ─── Policy limits gate ──────────────────────────────────
    // Check per-agent/fleet-wide feature toggles from the policy cache.
    // Runs after circuit breaker + denial tracking, before role-based gates.
    if (this.policyCache) {
      const policyDecision = checkToolPolicy(this.policyCache, toolName, context.agentRole);
      if (policyDecision && !policyDecision.allowed) {
        const reason = policyDecision.matchedRule?.reason ?? 'Policy denied';
        this.denialState = recordDenial(this.denialState, toolName, `Policy: ${reason}`, 'policy');
        this.logSecurityEvent(context.agentId, context.agentRole, toolName, 'POLICY_BLOCKED', {
          reason: 'policy_limits',
          policy_key: policyDecision.policyKey,
          set_by: policyDecision.matchedRule?.setBy ?? 'default',
          policy_reason: reason,
        });
        return {
          success: false,
          error: `Tool ${toolName} is not allowed by policy: ${reason}`,
          filesWritten: 0,
          memoryKeysWritten: 0,
          riskLevel: riskAssessment.level,
        };
      }
    }

    // ─── buildTool role-based filtering ─────────────────────
    if (isSafeTool(tool) && !isToolPermittedForRole(tool, context.agentRole)) {
      this.denialState = recordDenial(this.denialState, toolName, `Role ${context.agentRole} not permitted`, 'abac');
      return {
        success: false,
        error: `Tool ${toolName} is not available for the ${context.agentRole} role.`,
        filesWritten: 0,
        memoryKeysWritten: 0,
        riskLevel: riskAssessment.level,
      };
    }

    if (riskAssessment.level === 'HARD_GATE') {
      const blockedResult: ToolResult = {
        success: false,
        error: `Tool ${toolName} requires approval before execution.`,
        filesWritten: 0,
        memoryKeysWritten: 0,
        riskLevel: riskAssessment.level,
        approvalRequired: true,
        approvalReason: riskAssessment.reason,
      };

      this.logSecurityEvent(context.agentId, context.agentRole, toolName, 'ACTION_RISK_BLOCKED', {
        level: riskAssessment.level,
        reason: riskAssessment.reason,
      });

      this.logToolCall(
        context.agentId,
        context.agentRole,
        toolName,
        params,
        blockedResult,
        estimateToolCost(toolName),
        riskAssessment.level,
      );

      const blockedLog = this.callLog[this.callLog.length - 1];
      if (blockedLog) {
        void persistToolCallTrace(
          blockedLog,
          context.runId,
          context.assignmentId,
          context.turnNumber,
          context.retrievalMetadata?.get(toolName),
        );
      }
      void recordRunEvent({
        runId: context.runId,
        eventType: 'tool.blocked',
        trigger: 'action_risk',
        component: 'toolExecutor',
        approvalState: 'required',
        payload: {
          tool_name: toolName,
          reason: riskAssessment.reason,
        },
      });

      return blockedResult;
    }

    const preflight = normalizeAndValidateToolParams(toolName, tool, params);
    if (preflight.error) {
      return {
        success: false,
        error: preflight.error,
        filesWritten: 0,
        memoryKeysWritten: 0,
        riskLevel: riskAssessment.level,
      };
    }
    params = preflight.params;

    const scopeMismatch = hasContextScopeMismatch(params, context);
    if (scopeMismatch) {
      this.logSecurityEvent(context.agentId, context.agentRole, toolName, 'SCOPE_VIOLATION', { scopeMismatch });
      void recordRunEvent({
        runId: context.runId,
        eventType: 'tool.blocked',
        trigger: 'scope_violation',
        component: 'toolExecutor',
        approvalState: 'blocked',
        payload: {
          tool_name: toolName,
          reason: scopeMismatch,
        },
      });
      return {
        success: false,
        error: `Scoped execution blocked: ${scopeMismatch}`,
        filesWritten: 0,
        memoryKeysWritten: 0,
        riskLevel: riskAssessment.level,
      };
    }

    const disclosureTarget = classifyDisclosureTarget(toolName, params);
    if (disclosureTarget) {
      try {
        const disclosureResult = await applyDisclosurePolicy(
          context.agentId,
          disclosureTarget.communicationType,
          disclosureTarget.payload,
          disclosureTarget.recipientType,
          { toolName },
        );

        if (disclosureResult.requiresApproval) {
          return {
            success: false,
            error: `Tool ${toolName} requires approval before execution.`,
            filesWritten: 0,
            memoryKeysWritten: 0,
            riskLevel: riskAssessment.level,
            approvalRequired: true,
            approvalReason: disclosureResult.reason,
            data: disclosureResult.payload,
          };
        }

        params = disclosureTarget.applyToParams(disclosureResult.payload);
      } catch (err) {
        if (err instanceof DisclosureRequiredError) {
          return {
            success: false,
            error: err.message,
            filesWritten: 0,
            memoryKeysWritten: 0,
            riskLevel: riskAssessment.level,
          };
        }
        throw err;
      }
    }

    const capacityAction = buildCapacityAction(toolName, params);
    const capacityCheck = await enforceCapacityTier(context.agentRole, capacityAction);
    if (!capacityCheck.proceed) {
      const blockedResult: ToolResult = {
        success: false,
        error: capacityCheck.reason,
        filesWritten: 0,
        memoryKeysWritten: 0,
        riskLevel: riskAssessment.level,
        approvalRequired: capacityCheck.requiresApproval,
        approvalReason: capacityCheck.reason,
        registryEntryId: capacityCheck.registryEntryId ?? undefined,
      };

      this.logSecurityEvent(context.agentId, context.agentRole, toolName, 'CAPACITY_TIER_BLOCKED', {
        reason: capacityCheck.reason,
        requiresApproval: capacityCheck.requiresApproval,
        registryEntryId: capacityCheck.registryEntryId ?? undefined,
      });

      this.logToolCall(
        context.agentId,
        context.agentRole,
        toolName,
        params,
        blockedResult,
        estimateToolCost(toolName),
        riskAssessment.level,
      );

      const blockedLog = this.callLog[this.callLog.length - 1];
      if (blockedLog) {
        void persistToolCallTrace(
          blockedLog,
          context.runId,
          context.assignmentId,
          context.turnNumber,
          context.retrievalMetadata?.get(toolName),
        );
      }

      return blockedResult;
    }

    // ─── Hook lifecycle: pre-tool hooks ───────────────────────
    // Composite runner: per-tool in-process hooks first, then global HTTP hooks.
    // First deny from either source blocks the tool.
    {
      const toolMeta = getToolMeta(tool);
      const hookContext = {
        agentId: context.agentId,
        agentRole: context.agentRole,
        toolName,
        params,
        runId: context.runId,
        assignmentId: context.assignmentId,
        turnNumber: context.turnNumber,
        riskLevel: riskAssessment.level,
      };
      try {
        const hookDecision = await this.compositeHookRunner.runPreToolUse(
          hookContext,
          toolMeta.preHooks?.length ? toolMeta.preHooks : undefined,
        );

        if (!hookDecision.allow) {
          this.logSecurityEvent(context.agentId, context.agentRole, toolName, 'HOOK_BLOCKED', {
            reason: hookDecision.reason ?? 'Blocked by pre-tool hook',
          });
          return {
            success: false,
            error: hookDecision.reason ?? `Tool ${toolName} blocked by pre-tool hook.`,
            filesWritten: 0,
            memoryKeysWritten: 0,
            riskLevel: riskAssessment.level,
          };
        }
      } catch (hookError) {
        const hookMessage = (hookError as Error).message;
        this.logSecurityEvent(context.agentId, context.agentRole, toolName, 'HOOK_ERROR', {
          phase: 'pre_tool_use',
          error: hookMessage,
        });

        // Fail closed for non-autonomous actions, fail open for autonomous.
        if (riskAssessment.level !== 'AUTONOMOUS') {
          return {
            success: false,
            error: `Pre-tool hook failed for ${toolName}: ${hookMessage}`,
            filesWritten: 0,
            memoryKeysWritten: 0,
            riskLevel: riskAssessment.level,
          };
        }
      }
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

      // 2. Rate limit check — use buildTool metadata if available
      const effectiveRateLimit = getToolMeta(tool).rateLimit;
      if (!this.checkRateLimit(role, toolName, effectiveRateLimit)) {
        this.denialState = recordDenial(this.denialState, toolName, 'Rate limit exceeded', 'rate_limit');
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
        this.denialState = recordDenial(this.denialState, toolName, 'Budget exceeded', 'budget');
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

      const failureCounts = this.runToolFailures.get(agentId) ?? new Map<string, number>();
      const priorFailures = failureCounts.get(toolName) ?? 0;
      if (priorFailures >= TOOL_RETRY_CAP) {
        this.logSecurityEvent(agentId, role, toolName, 'RATE_LIMITED', {
          reason: 'tool_retry_cap_exceeded',
          retryCap: TOOL_RETRY_CAP,
        });
        return {
          success: false,
          error: `${toolName} blocked: retry cap (${TOOL_RETRY_CAP}) exceeded for this run.`,
          filesWritten: 0,
          memoryKeysWritten: 0,
          riskLevel: riskAssessment.level,
        };
      }

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

      const skipPreExecValueGateForChat =
        context.requestSource === 'on_demand' && !VALUE_GATE_ENFORCE_ON_DEMAND;

      if (
        !skipPreExecValueGateForChat
        && (WRITE_TOOL_SET.has(toolName) || riskAssessment.level !== 'AUTONOMOUS')
      ) {
        const gate = evaluateActionValue(toolName, params, estimatedCost, context);
        if (!gate.allow) {
          this.logSecurityEvent(agentId, role, toolName, 'ACTION_RISK_BLOCKED', {
            reason: 'pre_execution_value_gate',
            value_ratio: gate.valueRatio,
            confidence: gate.confidence,
          });
          void recordRunEvent({
            runId: context.runId,
            eventType: 'tool.blocked',
            trigger: 'pre_execution_value_gate',
            component: 'toolExecutor',
            approvalState: 'required',
            payload: {
              tool_name: toolName,
              value_ratio: gate.valueRatio,
              confidence: gate.confidence,
              function_score: gate.functionScore,
              t_plus_1_impact: gate.tPlus1Impact,
            },
          });
          return {
            success: false,
            error: `Pre-execution value gate blocked ${toolName}. value_ratio=${gate.valueRatio.toFixed(2)}, confidence=${gate.confidence.toFixed(2)}.`,
            filesWritten: 0,
            memoryKeysWritten: 0,
            riskLevel: riskAssessment.level,
            approvalRequired: true,
            approvalReason: 'Value ratio/confidence below threshold. Explicit approval required.',
          };
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
          error: `${toolName} rejected: you must call at least one data-reading tool before creating a decision or report. Use tools like get_product_metrics, get_company_vitals, get_financials, get_recent_activity, or any other data-reading tool to gather verified data first. Decisions must be backed by real data — if no data is available, report that status honestly instead.`,
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
        primaryModel: getTierModel('default'),
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

    // Use buildTool metadata timeout if available, otherwise fall back to legacy constants
    const toolSource = detectToolSource(toolName);
    const metaTimeout = getToolMeta(tool).timeoutMs;
    // Check the optional per-tool timeoutMs field (set by MCP tool factories)
    const directTimeout = (tool as { timeoutMs?: number }).timeoutMs;
    const timeoutMs = directTimeout && directTimeout !== 30_000
      ? directTimeout
      : metaTimeout !== 30_000  // non-default buildTool timeout takes precedence
        ? metaTimeout
        : VERY_LONG_RUNNING_TOOLS.has(toolName)
          ? VERY_LONG_TOOL_TIMEOUT_MS
          : QUICK_DEMO_TOOLS.has(toolName)
            ? QUICK_DEMO_TOOL_TIMEOUT_MS
            : LONG_RUNNING_TOOLS.has(toolName) || isMcpTool(toolName) || toolSource === 'mcp'
              ? LONG_TOOL_TIMEOUT_MS
              : DEFAULT_TOOL_TIMEOUT_MS;
    const executionSpan = startTraceSpan('tool.execute', {
      run_id: context.runId ?? 'unknown',
      assignment_id: context.assignmentId ?? 'none',
      agent_role: context.agentRole,
      agent_id: context.agentId,
      turn_number: context.turnNumber,
      tool_name: toolName,
      risk_level: riskAssessment.level,
      timeout_ms: timeoutMs,
    });
    const execStart = Date.now();
    const executionContext: ToolContext = {
      ...context,
      executeChildTool: async (childToolName, childParams) => {
        const childResult = await this.execute(childToolName, childParams, context);
        if (!childResult.success) {
          throw new Error(childResult.error ?? `Child tool ${childToolName} failed.`);
        }
        return childResult.data ?? null;
      },
    };

    try {
      const executeOnce = async (): Promise<ToolResult> => {
        const toolPromise = tool.execute(params, executionContext);

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

        return abacMiddleware(
          context.agentRole,
          {
            tool,
            toolName,
            params,
            taskId: context.assignmentId ?? context.runId,
            agentRole: context.agentRole,
            auditAgentId: context.agentRole,
          },
          () => Promise.race([toolPromise, timeoutPromise, abortPromise]),
        );
      };

      // Transient retry: retry tool execution on connection/DB errors (up to 2 retries)
      let result: ToolResult | undefined;
      let lastError: Error | undefined;
      for (let attempt = 0; attempt <= MAX_TOOL_TRANSIENT_RETRIES; attempt++) {
        try {
          result = await executeOnce();
          // If tool returned success:false with transient error text, retry
          if (!result.success && attempt < MAX_TOOL_TRANSIENT_RETRIES && TRANSIENT_TOOL_ERROR.test(result.error ?? '')) {
            const delay = TOOL_TRANSIENT_BASE_DELAY_MS * Math.pow(2, attempt);
            console.warn(`[ToolExecutor] Transient error on ${toolName} (attempt ${attempt + 1}/${MAX_TOOL_TRANSIENT_RETRIES + 1}): ${result.error?.slice(0, 100)}. Retrying in ${delay}ms.`);
            await new Promise(r => setTimeout(r, delay));
            continue;
          }
          break;
        } catch (err) {
          lastError = err as Error;
          if (attempt < MAX_TOOL_TRANSIENT_RETRIES && TRANSIENT_TOOL_ERROR.test(lastError.message)) {
            const delay = TOOL_TRANSIENT_BASE_DELAY_MS * Math.pow(2, attempt);
            console.warn(`[ToolExecutor] Transient throw on ${toolName} (attempt ${attempt + 1}/${MAX_TOOL_TRANSIENT_RETRIES + 1}): ${lastError.message.slice(0, 100)}. Retrying in ${delay}ms.`);
            await new Promise(r => setTimeout(r, delay));
            continue;
          }
          throw lastError;
        }
      }
      if (!result) throw lastError ?? new Error(`Tool ${toolName} failed after retries`);

      const finalResult: ToolResult = {
        success: result.success,
        data: result.data,
        error: result.error,
        filesWritten: result.filesWritten ?? 0,
        memoryKeysWritten: result.memoryKeysWritten ?? 0,
        constitutional_check: constitutionalCheckMeta,
        riskLevel: riskAssessment.level,
        registryEntryId: capacityCheck.registryEntryId ?? undefined,
      };

      finalResult.auditLogId = await persistToolActivityLog(toolName, params, finalResult, context) ?? undefined;

      // Update denial tracking on success/failure
      if (finalResult.success) {
        this.denialState = recordSuccess(this.denialState);
      } else {
        this.denialState = recordDenial(this.denialState, toolName, finalResult.error ?? 'execution failed', 'unknown');
      }

      if (finalResult.success) {
        if (capacityCheck.registryEntryId) {
          executeCommitment(capacityCheck.registryEntryId).catch((err: unknown) => {
            console.warn(`[ToolExecutor] Failed to mark commitment ${capacityCheck.registryEntryId} executed:`, (err as Error).message);
          });
        }

        const predictions = extractPredictionRecords(finalResult.data);
        if (predictions.length > 0) {
          try {
            const inserted = await persistPredictionRecords(context.runId, context.agentRole, predictions);
            if (inserted > 0) {
              finalResult.data = typeof finalResult.data === 'object' && finalResult.data !== null
                ? { ...finalResult.data as Record<string, unknown>, prediction_journal_records: inserted }
                : { result: finalResult.data, prediction_journal_records: inserted };
            }
          } catch (err) {
            console.warn(`[ToolExecutor] Prediction journaling failed for ${toolName}:`, (err as Error).message);
          }
        }
      }

      if (finalResult.success && hasSubstantiveData(finalResult.data)) {
        const evidenceUid = await recordEvidence({
          runId: context.runId,
          sourceType: 'tool_result',
          sourceTool: toolName,
          sourceRef: createEvidenceSourceRef(toolName, context.turnNumber, executionSpan.traceId),
          content: finalResult.data,
          metadata: {
            agent_role: context.agentRole,
            turn_number: context.turnNumber,
            assignment_id: context.assignmentId ?? null,
            directive_id: context.directiveId ?? null,
          },
        });
        if (evidenceUid) {
          finalResult.evidenceIds = [evidenceUid];
          const claimSource =
            typeof params.claim === 'string' && params.claim.trim().length > 0
              ? params.claim.trim()
              : `${toolName} output on turn ${context.turnNumber}`;
          await linkClaimToEvidence({
            runId: context.runId,
            claimText: claimSource,
            evidenceUid,
            verificationState: 'supported',
          });
        }
      }

      // Auto-verify mutations by reading back the written data
      if (isMutation(toolName) && finalResult.success) {
        const verifySpec = VERIFICATION_MAP[toolName];
        // paramKey='' means no-param readback (fire unconditionally); otherwise require param present
        if (verifySpec && (verifySpec.paramKey === '' || params[verifySpec.paramKey])) {
          try {
            const readbackParams = verifySpec.paramKey === '' ? {} : { [verifySpec.paramKey]: params[verifySpec.paramKey] };
            const verifyResult = await this.execute(verifySpec.name, readbackParams, context);
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
      const runFailureCounts = this.runToolFailures.get(context.agentId) ?? new Map<string, number>();
      if (finalResult.success) {
        runFailureCounts.set(toolName, 0);
      } else {
        runFailureCounts.set(toolName, (runFailureCounts.get(toolName) ?? 0) + 1);
      }
      this.runToolFailures.set(context.agentId, runFailureCounts);

      // Log the tool call
      this.logToolCall(
        context.agentId,
        context.agentRole,
        toolName,
        params,
        finalResult,
        estimateToolCost(toolName),
        riskAssessment.level,
      );

      // Track repeated tool failures for auto-escalation
      if (!finalResult.success) {
        trackToolFailure(context.agentRole, toolName, finalResult.error ?? 'unknown error', context.glyphorEventBus);
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

      // ─── Hook lifecycle: post-tool hooks ──────────────────────
      // Composite runner: global HTTP hooks first, then per-tool in-process.
      // Per-tool post-hooks may enrich the result.
      {
        const postToolMeta = getToolMeta(tool);
        const postHookContext = {
          agentId: context.agentId,
          agentRole: context.agentRole,
          toolName,
          params,
          runId: context.runId,
          assignmentId: context.assignmentId,
          turnNumber: context.turnNumber,
          riskLevel: riskAssessment.level,
          result: finalResult,
        };
        try {
          const enrichment = await this.compositeHookRunner.runPostToolUse(
            postHookContext,
            postToolMeta.postHooks?.length ? postToolMeta.postHooks : undefined,
          );
          if (enrichment && typeof enrichment === 'object') {
            // Merge enrichment into finalResult (post-hooks can add metadata)
            Object.assign(finalResult, enrichment);
          }
        } catch (hookError) {
          const hookMessage = (hookError as Error).message;
          this.logSecurityEvent(context.agentId, context.agentRole, toolName, 'HOOK_ERROR', {
            phase: 'post_tool_use',
            error: hookMessage,
          });
        }
      }

      executionSpan.end({
        success: finalResult.success,
        files_written: finalResult.filesWritten ?? 0,
        memory_keys_written: finalResult.memoryKeysWritten ?? 0,
      });
      void recordRunEvent({
        runId: context.runId,
        eventType: 'tool.completed',
        trigger: 'tool.execute',
        component: 'toolExecutor',
        approvalState: finalResult.approvalRequired ? 'required' : 'approved',
        traceId: executionSpan.traceId,
        payload: {
          tool_name: toolName,
          success: finalResult.success,
          risk_level: riskAssessment.level,
          evidence_ids: finalResult.evidenceIds ?? [],
          error: finalResult.error ?? null,
        },
      });
      return finalResult;
    } catch (error) {
      const failResult: ToolResult = {
        success: false,
        error: (error as Error).message,
        filesWritten: 0,
        memoryKeysWritten: 0,
        riskLevel: riskAssessment.level,
        registryEntryId: capacityCheck.registryEntryId ?? undefined,
      };

      this.logToolCall(
        context.agentId,
        context.agentRole,
        toolName,
        params,
        failResult,
        estimateToolCost(toolName),
        riskAssessment.level,
      );
      const runFailureCounts = this.runToolFailures.get(context.agentId) ?? new Map<string, number>();
      runFailureCounts.set(toolName, (runFailureCounts.get(toolName) ?? 0) + 1);
      this.runToolFailures.set(context.agentId, runFailureCounts);

      trackToolFailure(context.agentRole, toolName, (error as Error).message, context.glyphorEventBus);

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

      executionSpan.fail(error, {});
      void recordRunEvent({
        runId: context.runId,
        eventType: 'tool.failed',
        trigger: 'tool.execute',
        component: 'toolExecutor',
        traceId: executionSpan.traceId,
        payload: {
          tool_name: toolName,
          error: (error as Error).message,
          risk_level: riskAssessment.level,
        },
      });
      return failResult;
    }
  }
}

interface DisclosureToolTarget {
  communicationType: CommunicationType;
  recipientType: RecipientType;
  payload: Record<string, unknown>;
  applyToParams: (payload: Record<string, unknown>) => Record<string, unknown>;
}

function classifyDisclosureTarget(
  toolName: string,
  params: Record<string, unknown>,
): DisclosureToolTarget | null {
  if (toolName === 'send_email' || toolName === 'reply_to_email' || toolName === 'reply_email_with_attachments') {
    const emails = extractEmailsFromParams(params);
    return {
      communicationType: 'email',
      recipientType: inferRecipientTypeFromEmails(emails),
      payload: {
        body: typeof params.body === 'string' ? params.body : '',
      },
      applyToParams: (payload) => ({
        ...params,
        ...(typeof payload.body === 'string' ? { body: payload.body } : {}),
      }),
    };
  }

  if (toolName === 'post_to_slack') {
    return {
      communicationType: 'slack_message',
      recipientType: 'external',
      payload: {
        message: typeof params.message === 'string' ? params.message : '',
        sender_name: typeof params.sender_name === 'string'
          ? params.sender_name
          : typeof params.senderName === 'string'
            ? params.senderName
            : typeof params.username === 'string'
              ? params.username
              : undefined,
      },
      applyToParams: (payload) => ({
        ...params,
        ...(typeof payload.message === 'string' ? { message: payload.message } : {}),
        ...(typeof payload.sender_name === 'string' ? { sender_name: payload.sender_name } : {}),
        ...(typeof payload.senderName === 'string' ? { sender_name: payload.senderName } : {}),
      }),
    };
  }

  if (toolName === 'post_to_customer_teams' || toolName === 'send_dm' || toolName === 'post_to_channel') {
    return {
      communicationType: 'teams_message',
      recipientType: toolName === 'post_to_customer_teams' ? 'external' : 'internal',
      payload: {
        message: typeof params.message === 'string' ? params.message : '',
        senderName: typeof params.senderName === 'string'
          ? params.senderName
          : typeof params.sender_name === 'string'
            ? params.sender_name
            : undefined,
      },
      applyToParams: (payload) => ({
        ...params,
        ...(typeof payload.message === 'string' ? { message: payload.message } : {}),
        ...(typeof payload.senderName === 'string' ? { sender_name: payload.senderName } : {}),
      }),
    };
  }

  if (isExternalCommitment({ toolName, params })) {
    const emails = extractEmailsFromParams(params);
    return {
      communicationType: 'external_api_call',
      recipientType: inferRecipientTypeFromEmails(emails),
      payload: { ...params },
      applyToParams: (payload) => ({ ...params, ...payload }),
    };
  }

  return null;
}

function extractEmailsFromParams(params: Record<string, unknown>): string[] {
  const emails = new Set<string>();
  for (const key of ['to', 'cc', 'bcc', 'recipients', 'toRecipients', 'ccRecipients', 'attendees', 'signers', 'cc_recipients']) {
    collectEmails(params[key], emails);
  }
  return Array.from(emails);
}

function collectEmails(value: unknown, emails: Set<string>): void {
  if (!value) return;
  if (typeof value === 'string') {
    for (const part of value.split(/[;,]/)) {
      const email = part.trim().match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
      if (email) emails.add(email.toLowerCase());
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectEmails(entry, emails);
    return;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.email === 'string') emails.add(record.email.trim().toLowerCase());
    if (typeof record.address === 'string') emails.add(record.address.trim().toLowerCase());
    if (record.emailAddress && typeof record.emailAddress === 'object') collectEmails(record.emailAddress, emails);
  }
}

// ─── Tool Failure Tracking & Auto-Escalation ──────────────────────
// When the same tool fails repeatedly (across any agent), log a
// diagnostic alert so CTO/ops can investigate the tool implementation.
// When the threshold is hit, we emit a tool.failure GlyphorEvent so Nexus
// (platform-intel) is woken up to diagnose and fix the root cause.

import type { GlyphorEventBus } from './glyphorEventBus.js';

interface ToolFailureRecord {
  agentRole: string;
  error: string;
  timestamp: number;
}

const toolFailureLog = new Map<string, ToolFailureRecord[]>();
const FAILURE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const FAILURE_ESCALATION_THRESHOLD = 3;    // 3 failures in the window
const escalatedTools = new Set<string>();  // prevent duplicate escalations per process

function trackToolFailure(
  agentRole: string,
  toolName: string,
  error: string,
  eventBus?: GlyphorEventBus,
): void {
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

    const escalationPayload = {
      tool: toolName,
      failureCount: recent.length,
      affectedAgents: uniqueAgents,
      sampleErrors: uniqueErrors.slice(0, 3),
      window: '1h',
      recommendation: `Tool "${toolName}" has failed ${recent.length} times in the last hour across agents [${uniqueAgents.join(', ')}]. This likely indicates a code bug, not an agent error.`,
    };

    // Fire-and-forget: log to activity_log for CTO visibility
    systemQuery(
      `INSERT INTO activity_log (agent_role, action, summary, details)
       VALUES ($1, $2, $3, $4)`,
      [
        'system',
        'tool_repeated_failure',
        `Tool "${toolName}" failed ${recent.length}x in 1h across [${uniqueAgents.join(', ')}]`,
        JSON.stringify(escalationPayload),
      ],
    ).catch(err => console.warn(`[ToolFailureTracker] Failed to log escalation:`, (err as Error).message));

    // Emit tool.failure event to wake Nexus (platform-intel)
    if (eventBus) {
      eventBus.emit({
        type: 'tool.failure',
        source: 'system',
        priority: 'high',
        payload: escalationPayload,
      }).catch(err => console.warn(`[ToolFailureTracker] Failed to emit tool.failure event:`, (err as Error).message));
    }
  }
}
