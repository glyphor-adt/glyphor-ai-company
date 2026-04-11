import { CANONICAL_KEEP_ROSTER, isCanonicalKeepRole } from '@glyphor/shared';
import { systemQuery } from '@glyphor/shared/db';
import { getCriticalBaselineToolNames, isCriticalBaselineTool } from './criticalRoleToolBaseline.js';
import type { CompanyAgentRole, ToolDeclaration } from './types.js';

const EXECUTION_POLICY_CACHE_TTL_MS = 60_000;
const BOOTSTRAP_BASELINE_TOOLS = new Set<string>([
  'list_my_tools',
  'tool_search',
  'check_tool_access',
  'request_tool_access',
  'request_new_tool',
]);

export const LIVE_RUNTIME_ROSTER = [...CANONICAL_KEEP_ROSTER];

interface ExecutionPolicyCacheEntry {
  allowedTools: Set<string>;
  blockedTools: Set<string>;
  hasPolicyRows: boolean;
  fetchedAt: number;
}

export interface ExecutionAuthorizationDecision {
  allowed: boolean;
  reason:
    | 'allowed'
    | 'bootstrap_baseline'
    | 'critical_baseline'
    | 'role_not_live'
    | 'tool_not_granted'
    | 'emergency_blocked';
  message: string;
}

const executionPolicyCache = new Map<string, ExecutionPolicyCacheEntry>();

export function isLiveRuntimeRole(role: string): role is CompanyAgentRole {
  return isCanonicalKeepRole(role);
}

async function loadExecutionPolicy(agentRole: string): Promise<ExecutionPolicyCacheEntry | null> {
  const now = Date.now();
  const cached = executionPolicyCache.get(agentRole);
  if (cached && now - cached.fetchedAt < EXECUTION_POLICY_CACHE_TTL_MS) {
    return cached;
  }

  try {
    const rows = await systemQuery<{ tool_name: string; is_blocked: boolean | null }>(
      `SELECT tool_name, COALESCE(is_blocked, false) AS is_blocked
         FROM agent_tool_grants
        WHERE agent_role = $1
          AND is_active = true
          AND (expires_at IS NULL OR expires_at > NOW())`,
      [agentRole],
    );

    const allowedTools = new Set<string>();
    const blockedTools = new Set<string>();
    for (const row of rows) {
      if (row.is_blocked) {
        blockedTools.add(row.tool_name);
        continue;
      }
      allowedTools.add(row.tool_name);
    }

    const entry: ExecutionPolicyCacheEntry = {
      allowedTools,
      blockedTools,
      hasPolicyRows: rows.length > 0,
      fetchedAt: now,
    };
    executionPolicyCache.set(agentRole, entry);
    return entry;
  } catch {
    return null;
  }
}

export async function authorizeToolExecution(input: {
  agentRole: string;
  toolName: string;
}): Promise<ExecutionAuthorizationDecision> {
  const { agentRole, toolName } = input;
  if (!isLiveRuntimeRole(agentRole)) {
    return {
      allowed: false,
      reason: 'role_not_live',
      message: `Role "${agentRole}" is not on the live runtime roster and cannot execute tools.`,
    };
  }

  const policy = await loadExecutionPolicy(agentRole);
  if (policy) {
    if (policy.blockedTools.has(toolName)) {
      return {
        allowed: false,
        reason: 'emergency_blocked',
        message: `${toolName} is currently blocked for ${agentRole}. Contact an admin to unblock.`,
      };
    }

    if (policy.allowedTools.has(toolName)) {
      return {
        allowed: true,
        reason: 'allowed',
        message: `${toolName} is allowed for ${agentRole}.`,
      };
    }

    if (isCriticalBaselineTool(agentRole, toolName)) {
      return {
        allowed: true,
        reason: 'critical_baseline',
        message: `${toolName} is allowed for ${agentRole} via critical role baseline.`,
      };
    }

    if (policy.hasPolicyRows) {
      return {
        allowed: false,
        reason: 'tool_not_granted',
        message: `Tool ${toolName} is not granted to ${agentRole}.`,
      };
    }
  }

  if (isCriticalBaselineTool(agentRole, toolName)) {
    return {
      allowed: true,
      reason: 'critical_baseline',
      message: `${toolName} is allowed for ${agentRole} via critical role baseline.`,
    };
  }

  if (BOOTSTRAP_BASELINE_TOOLS.has(toolName)) {
    return {
      allowed: true,
      reason: 'bootstrap_baseline',
      message: `${toolName} is allowed for ${agentRole} via the bootstrap baseline.`,
    };
  }

  return {
    allowed: false,
    reason: 'tool_not_granted',
    message: `Tool ${toolName} is not granted to ${agentRole}.`,
  };
}

export async function isToolBlockedByPolicy(
  agentRole: string,
  toolName: string,
): Promise<boolean> {
  const decision = await authorizeToolExecution({ agentRole, toolName });
  return !decision.allowed && decision.reason === 'emergency_blocked';
}

export async function loadGrantedToolNamesByPolicy(
  agentRole: string,
): Promise<string[]> {
  if (!isLiveRuntimeRole(agentRole)) return [];
  const policy = await loadExecutionPolicy(agentRole);
  const fromDb = policy ? Array.from(policy.allowedTools) : [];
  const baseline = getCriticalBaselineToolNames(agentRole);
  return [...new Set([...fromDb, ...baseline])];
}

export async function filterGrantedToolDeclarations(
  agentRole: string,
  declarations: ToolDeclaration[],
): Promise<ToolDeclaration[]> {
  const granted = new Set(await loadGrantedToolNamesByPolicy(agentRole));
  if (granted.size === 0) return [];
  return declarations.filter((declaration) => granted.has(declaration.name));
}

export function invalidateExecutionPolicyCache(agentRole?: string): void {
  if (agentRole) {
    executionPolicyCache.delete(agentRole);
  } else {
    executionPolicyCache.clear();
  }
}
