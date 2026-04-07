/**
 * Policy Limits — Per-Agent Feature Toggles & Compliance Gates
 *
 * Provides a DB-backed policy system for controlling agent capabilities
 * beyond the static buildTool role-based gates. Policies can be toggled
 * per-agent, per-tool, or fleet-wide without redeploying.
 *
 * Inspired by Claude Code's policyLimits service:
 *   - Non-blocking startup (policies load in background)
 *   - Cached with short TTL (avoids per-tool-call DB hits)
 *   - Fail-open by default (availability over safety for most policies)
 *   - Fail-closed for explicit security policies
 *
 * Storage: `agent_policy_limits` table (per-agent-role policies)
 *          `system_config` table (fleet-wide feature flags)
 *
 * Usage:
 *
 *   // At startup:
 *   const policyCache = new PolicyLimitsCache();
 *   await policyCache.initialize();  // non-blocking background load
 *
 *   // Before tool execution:
 *   const allowed = policyCache.isPolicyAllowed('can_deploy', 'devops-engineer');
 *
 *   // Admin toggle (ops tool or dashboard):
 *   await setPolicy('devops-engineer', 'can_deploy', false, 'kristina', 'Freeze for release');
 */

import { systemQuery } from '@glyphor/shared/db';
import type { CompanyAgentRole } from './types.js';

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export interface PolicyRule {
  /** Unique policy key (e.g., 'can_deploy', 'allow_external_api', 'enable_deep_research'). */
  policyKey: string;
  /** Whether the action/feature is allowed. */
  allowed: boolean;
  /** Which agent role this applies to. Null = fleet-wide. */
  agentRole: CompanyAgentRole | null;
  /** Optional: restrict to specific tool names. Null = all tools. */
  toolName: string | null;
  /** Who set this policy. */
  setBy: string;
  /** Human-readable reason. */
  reason: string;
  /** Auto-expire timestamp. Null = permanent. */
  expiresAt: string | null;
  /** When the policy was set/updated. */
  updatedAt: string;
}

export interface PolicyDecision {
  allowed: boolean;
  policyKey: string;
  /** Which rule matched (null = no rule, used default). */
  matchedRule: PolicyRule | null;
  /** How the decision was made. */
  source: 'cache' | 'db' | 'default';
}

export interface PolicyLimitsCacheStats {
  ruleCount: number;
  lastRefreshAt: number;
  cacheAgeMs: number;
  stale: boolean;
}

// ═══════════════════════════════════════════════════════════════════
// WELL-KNOWN POLICY KEYS
// ═══════════════════════════════════════════════════════════════════

/**
 * Policy keys that fail-closed (denied when no rule exists).
 * Everything else fails-open (allowed when no rule exists).
 */
export const FAIL_CLOSED_POLICIES = new Set([
  'can_deploy_production',
  'can_send_external_email',
  'can_post_internal_teams_channels',
  'can_write_customer_teams',
  'can_write_sharepoint',
  'can_create_calendar_events',
  'can_modify_billing',
  'can_delete_data',
  'can_access_secrets',
]);

/**
 * Well-known policy keys for documentation and ops tooling.
 */
export const KNOWN_POLICY_KEYS = [
  'can_deploy',
  'can_deploy_production',
  'can_deploy_staging',
  'can_send_external_email',
  'can_send_slack',
  'can_post_internal_teams_channels',
  'can_write_customer_teams',
  'can_write_sharepoint',
  'can_create_calendar_events',
  'can_modify_billing',
  'can_delete_data',
  'can_access_secrets',
  'can_use_deep_research',
  'can_use_web_search',
  'can_create_pr',
  'can_merge_pr',
  'can_run_migrations',
  'enable_extended_thinking',
  'enable_concurrent_tools',
  'enable_memory_consolidation',
] as const;

export type KnownPolicyKey = typeof KNOWN_POLICY_KEYS[number];

// ═══════════════════════════════════════════════════════════════════
// CACHE
// ═══════════════════════════════════════════════════════════════════

/** Cache TTL — balance freshness vs DB load. */
const CACHE_TTL_MS = 30_000; // 30 seconds

/** Background poll interval. */
const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export class PolicyLimitsCache {
  private rules: PolicyRule[] = [];
  private loadedAt = 0;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private loadingPromise: Promise<void> | null = null;
  private initialized = false;

  // ─── Lifecycle ──────────────────────────────────────────────

  /**
   * Non-blocking initialization. Starts loading policies in the background
   * and sets up periodic refresh. Does NOT block the caller.
   */
  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;

    // Fire-and-forget initial load
    this.loadingPromise = this.refresh().catch(err => {
      console.warn('[PolicyLimits] Initial load failed:', (err as Error).message);
    });

    // Start background poller
    this.pollTimer = setInterval(() => {
      this.refresh().catch(err => {
        console.warn('[PolicyLimits] Background refresh failed:', (err as Error).message);
      });
    }, POLL_INTERVAL_MS);

    // Don't block Node exit
    if (this.pollTimer && typeof this.pollTimer === 'object' && 'unref' in this.pollTimer) {
      this.pollTimer.unref();
    }
  }

  /**
   * Wait for the initial load to complete (optional).
   * Times out after 5 seconds to avoid blocking startup.
   */
  async waitForLoad(): Promise<void> {
    if (!this.loadingPromise) return;
    const timeout = new Promise<void>(resolve => setTimeout(resolve, 5_000));
    await Promise.race([this.loadingPromise, timeout]);
  }

  /** Stop background polling (for shutdown / tests). */
  destroy(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.initialized = false;
  }

  // ─── Query ─────────────────────────────────────────────────

  /**
   * Check if a policy is allowed for a given agent role.
   *
   * Resolution order (first match wins):
   *   1. Agent-specific + tool-specific rule
   *   2. Agent-specific rule (any tool)
   *   3. Fleet-wide + tool-specific rule
   *   4. Fleet-wide rule (any tool)
   *   5. Default: fail-open (true) unless policy is in FAIL_CLOSED_POLICIES
   *
   * This is SYNCHRONOUS — reads only from the in-memory cache.
   * If the cache is empty (initial load not done), returns the default.
   */
  isPolicyAllowed(
    policyKey: string,
    agentRole: CompanyAgentRole,
    toolName?: string,
  ): PolicyDecision {
    const now = Date.now();
    const activeRules = this.rules.filter(r =>
      r.policyKey === policyKey &&
      (r.expiresAt === null || new Date(r.expiresAt).getTime() > now),
    );

    // Resolution: most specific rule wins
    const match =
      // 1. Agent + tool specific
      (toolName && activeRules.find(r => r.agentRole === agentRole && r.toolName === toolName)) ||
      // 2. Agent specific (any tool)
      activeRules.find(r => r.agentRole === agentRole && r.toolName === null) ||
      // 3. Fleet-wide + tool specific
      (toolName && activeRules.find(r => r.agentRole === null && r.toolName === toolName)) ||
      // 4. Fleet-wide (any tool)
      activeRules.find(r => r.agentRole === null && r.toolName === null) ||
      null;

    if (match) {
      return {
        allowed: match.allowed,
        policyKey,
        matchedRule: match,
        source: 'cache',
      };
    }

    // Default: fail-open unless explicitly fail-closed
    const defaultAllowed = !FAIL_CLOSED_POLICIES.has(policyKey);
    return {
      allowed: defaultAllowed,
      policyKey,
      matchedRule: null,
      source: 'default',
    };
  }

  /**
   * Get all active policies for an agent role (for prompt injection / ops view).
   */
  getActivePolicies(agentRole: CompanyAgentRole): PolicyRule[] {
    const now = Date.now();
    return this.rules.filter(r =>
      (r.agentRole === null || r.agentRole === agentRole) &&
      (r.expiresAt === null || new Date(r.expiresAt).getTime() > now),
    );
  }

  /** Cache stats for diagnostics/ops. */
  getStats(): PolicyLimitsCacheStats {
    const age = this.loadedAt > 0 ? Date.now() - this.loadedAt : Infinity;
    return {
      ruleCount: this.rules.length,
      lastRefreshAt: this.loadedAt,
      cacheAgeMs: age,
      stale: age > CACHE_TTL_MS,
    };
  }

  // ─── Refresh ───────────────────────────────────────────────

  /**
   * Refresh the cache from the database.
   * Called automatically by the background poller.
   */
  async refresh(): Promise<void> {
    try {
      const rows = await systemQuery<{
        policy_key: string;
        allowed: boolean;
        agent_role: string | null;
        tool_name: string | null;
        set_by: string;
        reason: string;
        expires_at: string | null;
        updated_at: string;
      }>(
        `SELECT policy_key, allowed, agent_role, tool_name, set_by, reason, expires_at, updated_at
         FROM agent_policy_limits
         WHERE (expires_at IS NULL OR expires_at > NOW())
         ORDER BY
           CASE WHEN agent_role IS NOT NULL THEN 0 ELSE 1 END,
           CASE WHEN tool_name IS NOT NULL THEN 0 ELSE 1 END,
           updated_at DESC`,
      );

      this.rules = rows.map(row => ({
        policyKey: row.policy_key,
        allowed: row.allowed,
        agentRole: row.agent_role as CompanyAgentRole | null,
        toolName: row.tool_name,
        setBy: row.set_by,
        reason: row.reason ?? '',
        expiresAt: row.expires_at,
        updatedAt: row.updated_at,
      }));

      this.loadedAt = Date.now();
    } catch (err) {
      // Table may not exist yet — keep existing cache
      console.warn('[PolicyLimits] Refresh failed:', (err as Error).message);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// WRITE OPERATIONS (Admin/Ops)
// ═══════════════════════════════════════════════════════════════════

/**
 * Set a policy rule for an agent role (or fleet-wide).
 *
 * Upserts on (policy_key, agent_role, tool_name) — only one rule
 * per combination. Supports auto-expiration.
 */
export async function setPolicy(
  agentRole: CompanyAgentRole | null,
  policyKey: string,
  allowed: boolean,
  setBy: string,
  reason: string,
  options?: {
    toolName?: string;
    expiresInHours?: number;
  },
): Promise<void> {
  const expiresAt = options?.expiresInHours
    ? new Date(Date.now() + options.expiresInHours * 3_600_000).toISOString()
    : null;

  await systemQuery(
    `INSERT INTO agent_policy_limits
       (policy_key, allowed, agent_role, tool_name, set_by, reason, expires_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (policy_key, COALESCE(agent_role, ''), COALESCE(tool_name, ''))
     DO UPDATE SET
       allowed = EXCLUDED.allowed,
       set_by = EXCLUDED.set_by,
       reason = EXCLUDED.reason,
       expires_at = EXCLUDED.expires_at,
       updated_at = NOW()`,
    [
      policyKey,
      allowed,
      agentRole,
      options?.toolName ?? null,
      setBy,
      reason,
      expiresAt,
    ],
  );
}

/**
 * Remove a policy rule entirely (returns to default behavior).
 */
export async function clearPolicy(
  agentRole: CompanyAgentRole | null,
  policyKey: string,
  toolName?: string,
): Promise<boolean> {
  const result = await systemQuery<{ id: string }>(
    `DELETE FROM agent_policy_limits
     WHERE policy_key = $1
       AND COALESCE(agent_role, '') = COALESCE($2, '')
       AND COALESCE(tool_name, '') = COALESCE($3, '')
     RETURNING id`,
    [policyKey, agentRole, toolName ?? null],
  );
  return result.length > 0;
}

/**
 * List all active policies (for ops dashboard / audit).
 */
export async function listPolicies(
  filter?: { agentRole?: CompanyAgentRole; policyKey?: string },
): Promise<PolicyRule[]> {
  let sql = `SELECT policy_key, allowed, agent_role, tool_name, set_by, reason, expires_at, updated_at
             FROM agent_policy_limits
             WHERE (expires_at IS NULL OR expires_at > NOW())`;
  const params: unknown[] = [];

  if (filter?.agentRole) {
    params.push(filter.agentRole);
    sql += ` AND (agent_role = $${params.length} OR agent_role IS NULL)`;
  }
  if (filter?.policyKey) {
    params.push(filter.policyKey);
    sql += ` AND policy_key = $${params.length}`;
  }

  sql += ` ORDER BY policy_key, agent_role, tool_name`;

  const rows = await systemQuery<{
    policy_key: string;
    allowed: boolean;
    agent_role: string | null;
    tool_name: string | null;
    set_by: string;
    reason: string;
    expires_at: string | null;
    updated_at: string;
  }>(sql, params);

  return rows.map(row => ({
    policyKey: row.policy_key,
    allowed: row.allowed,
    agentRole: row.agent_role as CompanyAgentRole | null,
    toolName: row.tool_name,
    setBy: row.set_by,
    reason: row.reason ?? '',
    expiresAt: row.expires_at,
    updatedAt: row.updated_at,
  }));
}

// ═══════════════════════════════════════════════════════════════════
// TOOL-LEVEL POLICY MAPPING
// ═══════════════════════════════════════════════════════════════════

/**
 * Map of tool names to the policy key that gates them.
 * Tools not in this map are ungated (always allowed unless
 * blocked by other enforcement layers).
 */
const TOOL_POLICY_MAP: Record<string, string> = {
  deploy_staging: 'can_deploy_staging',
  deploy_production: 'can_deploy_production',
  deploy_service: 'can_deploy',
  send_email: 'can_send_external_email',
  reply_to_email: 'can_send_external_email',
  reply_email_with_attachments: 'can_send_external_email',
  send_slack_message: 'can_send_slack',
  post_to_channel: 'can_post_internal_teams_channels',
  post_to_teams: 'can_post_internal_teams_channels',
  post_to_briefings: 'can_post_internal_teams_channels',
  post_to_deliverables: 'can_post_internal_teams_channels',
  send_teams_message: 'can_post_internal_teams_channels',
  post_to_customer_teams: 'can_write_customer_teams',
  request_teams_approval: 'can_write_customer_teams',
  upload_to_sharepoint: 'can_write_sharepoint',
  create_calendar_event: 'can_create_calendar_events',
  create_pull_request: 'can_create_pr',
  merge_pull_request: 'can_merge_pr',
  run_migration: 'can_run_migrations',
  delete_resource: 'can_delete_data',
  read_secret: 'can_access_secrets',
  write_secret: 'can_access_secrets',
};

/**
 * Check if a tool call is allowed by policy limits.
 *
 * Returns null if the tool is ungated (no policy applies).
 * Returns a PolicyDecision if a policy was evaluated.
 */
export function checkToolPolicy(
  cache: PolicyLimitsCache,
  toolName: string,
  agentRole: CompanyAgentRole,
): PolicyDecision | null {
  const policyKey = TOOL_POLICY_MAP[toolName];
  if (!policyKey) return null; // Ungated tool

  return cache.isPolicyAllowed(policyKey, agentRole, toolName);
}
