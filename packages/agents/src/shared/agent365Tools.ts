/**
 * Agent 365 MCP Tools — Async factory for Microsoft Agent 365 MCP servers
 *
 * Enable with env var: AGENT365_ENABLED=true
 * Required env vars: AGENT365_CLIENT_ID, AGENT365_CLIENT_SECRET, AGENT365_TENANT_ID
 * Optional per-agent overrides:
 *   AGENT365_<ROLE>_CLIENT_ID
 *   AGENT365_<ROLE>_CLIENT_SECRET
 *   AGENT365_<ROLE>_TENANT_ID
 */

import { getAgentIdentityAppId, type ToolDefinition } from '@glyphor/agent-runtime';
import type { Agent365ToolBridge } from '@glyphor/integrations';
import { createAgent365Tools as initAgent365Bridge } from '@glyphor/integrations';

// ── Standard M365 MCP Servers ────────────────────────────────────

/** All Microsoft Agent 365 MCP servers that Glyphor agents connect to. */
export const STANDARD_M365_SERVERS = [
  'mcp_MailTools',
  'mcp_CalendarTools',
  'mcp_ODSPRemoteServer',
  'mcp_TeamsServer',
  'mcp_M365Copilot',
  'mcp_WordServer',
] as const;

/** Standard servers plus Microsoft 365 user profile tools for org-aware roles. */
export const PROFILE_AWARE_M365_SERVERS = [
  ...STANDARD_M365_SERVERS,
  'mcp_MeServer',
] as const;

const ORG_PROFILE_AGENT_ROLES = new Set([
  'chief-of-staff',
  'global-admin',
  'm365-admin',
  'head-of-hr',
  'org-analyst',
  'onboarding-specialist',
]);

// ── Singleton Bridge ─────────────────────────────────────────────

let activeBridge: Agent365ToolBridge | null = null;

function normalizeRoleKey(role: string): string {
  return role
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
}

function resolveAgent365Credentials(agentRole?: string): {
  clientId: string;
  clientSecret: string;
  tenantId: string;
} | null {
  const sharedClientId = process.env.AGENT365_CLIENT_ID;
  const sharedClientSecret = process.env.AGENT365_CLIENT_SECRET;
  const sharedTenantId = process.env.AGENT365_TENANT_ID;

  if (!agentRole) {
    if (!sharedClientId || !sharedClientSecret || !sharedTenantId) return null;
    return {
      clientId: sharedClientId,
      clientSecret: sharedClientSecret,
      tenantId: sharedTenantId,
    };
  }

  const roleKey = normalizeRoleKey(agentRole);
  const envClientId = process.env[`AGENT365_${roleKey}_CLIENT_ID`];
  const envClientSecret = process.env[`AGENT365_${roleKey}_CLIENT_SECRET`];
  const envTenantId = process.env[`AGENT365_${roleKey}_TENANT_ID`] ?? sharedTenantId;
  const configuredAppId = getAgentIdentityAppId(agentRole);
  const roleClientId = envClientId ?? configuredAppId;

  if (roleClientId && envClientSecret && envTenantId) {
    return {
      clientId: roleClientId,
      clientSecret: envClientSecret,
      tenantId: envTenantId,
    };
  }

  if (roleClientId && !envClientSecret) {
    console.warn(`[Agent365] Per-agent app id found for ${agentRole} but AGENT365_${roleKey}_CLIENT_SECRET is missing. Falling back to shared Agent 365 credentials.`);
  }

  if (!sharedClientId || !sharedClientSecret || !sharedTenantId) return null;
  return {
    clientId: sharedClientId,
    clientSecret: sharedClientSecret,
    tenantId: sharedTenantId,
  };
}

function resolveDefaultServerFilter(agentRole?: string): string[] {
  if (agentRole && ORG_PROFILE_AGENT_ROLES.has(agentRole)) {
    return [...PROFILE_AWARE_M365_SERVERS];
  }

  return [...STANDARD_M365_SERVERS];
}

// ── Public Factory ───────────────────────────────────────────────

/**
 * Connect to Agent 365 MCP servers and return discovered tools as ToolDefinitions.
 * Uses MSAL client credentials flow to auto-acquire and cache tokens.
 *
 * @param serverFilter Optional list of MCP server names to load.
 *                     Defaults to STANDARD_M365_SERVERS, with mcp_MeServer added for org-aware roles.
 *
 * Returns an empty array if:
 *   - AGENT365_ENABLED is not 'true'
 *   - Required env vars are missing
 *   - MCP server connection fails (logs error, doesn't crash)
 */
export async function createAgent365McpTools(agentRoleOrServerFilter?: string | string[], maybeServerFilter?: string[]): Promise<ToolDefinition[]> {
  if (process.env.AGENT365_ENABLED !== 'true') {
    return [];
  }

  const agentRole = typeof agentRoleOrServerFilter === 'string' ? agentRoleOrServerFilter : undefined;
  const serverFilter = Array.isArray(agentRoleOrServerFilter) ? agentRoleOrServerFilter : maybeServerFilter;
  const credentials = resolveAgent365Credentials(agentRole);

  if (!credentials) {
    console.warn('[Agent365] AGENT365_ENABLED=true but AGENT365_CLIENT_ID, AGENT365_CLIENT_SECRET, or AGENT365_TENANT_ID missing. Skipping.');
    return [];
  }

  try {
    const bridge = await initAgent365Bridge({
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      tenantId: credentials.tenantId,
    }, serverFilter ?? resolveDefaultServerFilter(agentRole));

    activeBridge = bridge;
    console.log(`[Agent365] Initialized ${bridge.tools.length} MCP tools`);
    return bridge.tools;
  } catch (err) {
    console.error('[Agent365] Failed to initialize MCP bridge:', (err as Error).message);
    return [];
  }
}

/**
 * Shut down all Agent 365 MCP connections.
 * Call this at process shutdown or between runs to clean up.
 */
export async function closeAgent365Bridge(): Promise<void> {
  if (activeBridge) {
    await activeBridge.close();
    activeBridge = null;
  }
}
