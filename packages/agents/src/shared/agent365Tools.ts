/**
 * Agent 365 MCP Tools — Async factory for Microsoft Agent 365 MCP servers
 *
 * Enable with env var: AGENT365_ENABLED=true
 * Required env vars: AGENT365_CLIENT_ID, AGENT365_TENANT_ID, AGENT365_CLIENT_SECRET
 * Required env vars: AGENT365_APP_INSTANCE_ID, AGENT365_AGENTIC_USER_ID
 * Optional: AGENT365_BLUEPRINT_ID
 * Optional per-agent overrides:
 *   AGENT365_<ROLE>_CLIENT_ID
 *   AGENT365_<ROLE>_CLIENT_SECRET
 *   AGENT365_<ROLE>_TENANT_ID
 */

import { type ToolDefinition } from '@glyphor/agent-runtime';
import { getAgentSpId, getAgentEntraUserId } from '@glyphor/agent-runtime';
import type { Agent365ToolBridge } from '@glyphor/integrations';
import { createAgent365Tools as initAgent365Bridge } from '@glyphor/integrations';

// ── Standard M365 MCP Servers ────────────────────────────────────

/** Core Microsoft Agent 365 MCP servers currently covered by existing smoke checks. */
export const STANDARD_M365_SERVERS = [
  'mcp_MailTools',
  'mcp_CalendarTools',
  'mcp_ODSPRemoteServer',
  'mcp_TeamsServer',
  'mcp_M365Copilot',
  'mcp_WordServer',
] as const;

/** Full supported Microsoft Agent 365 MCP server catalog. */
export const ALL_M365_SERVERS = [
  ...STANDARD_M365_SERVERS,
  'mcp_UserProfile',
  'mcp_SharePointLists',
] as const;

/** All agents get the full M365 MCP server catalog — every agent has an Agent365 license. */
function getDefaultAgent365Servers(_agentRole?: string): readonly string[] {
  return ALL_M365_SERVERS;
}

// ── Singleton Bridge ─────────────────────────────────────────────

let activeBridge: Agent365ToolBridge | null = null;

function resolveAgent365Credentials(_agentRole?: string): {
  clientId: string;
  clientSecret: string;
  tenantId: string;
} | null {
  // Always use shared credentials — per-agent Entra apps are regular directory
  // users, not agentic users created by Teams agent installation, so the 3-step
  // MsalTokenProvider flow fails when per-agent client IDs are used.
  const clientId = process.env.AGENT365_CLIENT_ID;
  const clientSecret = process.env.AGENT365_CLIENT_SECRET ?? '';
  const tenantId = process.env.AGENT365_TENANT_ID;

  if (!clientId || !tenantId) return null;
  return { clientId, clientSecret, tenantId };
}

// ── Public Factory ───────────────────────────────────────────────

/**
 * Connect to Agent 365 MCP servers and return discovered tools as ToolDefinitions.
 * Uses Agent Identity Authentication (client-credentials-only, no refresh token).
 *
 * @param serverFilter Optional list of MCP server names to load.
 *                     Defaults to ALL_M365_SERVERS so the full supported catalog is available.
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
  const serverFilter = Array.isArray(agentRoleOrServerFilter)
    ? agentRoleOrServerFilter
    : (maybeServerFilter ?? [...getDefaultAgent365Servers(agentRole)]);
  const credentials = resolveAgent365Credentials(agentRole);

  if (!credentials) {
    console.warn('[Agent365] AGENT365_ENABLED=true but AGENT365_CLIENT_ID or AGENT365_TENANT_ID missing. Skipping.');
    return [];
  }

  // Resolve per-agent identity from agentIdentities.json; fall back to shared env vars.
  // Each agent has its own agentic user (own mailbox, UPN, calendar) created by
  // the Teams agent installation. spId = agentAppInstanceId, entraUserId = agenticUserId.
  const agentAppInstanceId = (agentRole ? getAgentSpId(agentRole) : null)
    ?? process.env.AGENT365_APP_INSTANCE_ID;
  const agenticUserId = (agentRole ? getAgentEntraUserId(agentRole) : null)
    ?? process.env.AGENT365_AGENTIC_USER_ID;

  if (!agentAppInstanceId || !agenticUserId) {
    console.warn(`[Agent365] No identity found for agent ${agentRole ?? 'unknown'}. Set blueprintSpId/entraUserId in agentIdentities.json or AGENT365_APP_INSTANCE_ID/AGENT365_AGENTIC_USER_ID env vars. Skipping.`);
    return [];
  }

  if (agentRole) {
    console.log(`[Agent365] Using per-agent identity for ${agentRole}: instanceId=${agentAppInstanceId.slice(0, 8)}…`);
  }

  const MCP_INIT_TIMEOUT_MS = 30_000;

  try {
    // Close any previous bridge to avoid connection leaks and stale MSAL tokens
    await closeAgent365Bridge();

    const bridgePromise = initAgent365Bridge({
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      tenantId: credentials.tenantId,
      agenticAppId: process.env.AGENT365_BLUEPRINT_ID,
      agentAppInstanceId,
      agenticUserId,
    }, serverFilter);

    // Timeout guard: if MCP init hangs beyond 15s, fall back to core tools only
    const bridge = await Promise.race([
      bridgePromise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Agent365 MCP init timed out after ${MCP_INIT_TIMEOUT_MS}ms`)), MCP_INIT_TIMEOUT_MS),
      ),
    ]);

    activeBridge = bridge;
    console.log(`[Agent365] Initialized ${bridge.tools.length} MCP tools`);
    return bridge.tools;
  } catch (err) {
    console.error('[Agent365] Failed to initialize MCP bridge (falling back to core tools):', (err as Error).message);
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
