/**
 * Agent 365 MCP Tools — Async factory for Microsoft Agent 365 MCP servers
 *
 * Enable with env var: AGENT365_ENABLED=true
 * Required env vars: AGENT365_CLIENT_ID, AGENT365_CLIENT_SECRET, AGENT365_TENANT_ID
 */

import type { ToolDefinition } from '@glyphor/agent-runtime';
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

// ── Singleton Bridge ─────────────────────────────────────────────

let activeBridge: Agent365ToolBridge | null = null;

// ── Public Factory ───────────────────────────────────────────────

/**
 * Connect to Agent 365 MCP servers and return discovered tools as ToolDefinitions.
 * Uses MSAL client credentials flow to auto-acquire and cache tokens.
 *
 * @param serverFilter Optional list of MCP server names to load.
 *                     Defaults to STANDARD_M365_SERVERS (all 6 Microsoft servers).
 *
 * Returns an empty array if:
 *   - AGENT365_ENABLED is not 'true'
 *   - Required env vars are missing
 *   - MCP server connection fails (logs error, doesn't crash)
 */
export async function createAgent365McpTools(serverFilter?: string[]): Promise<ToolDefinition[]> {
  if (process.env.AGENT365_ENABLED !== 'true') {
    return [];
  }

  const clientId = process.env.AGENT365_CLIENT_ID;
  const clientSecret = process.env.AGENT365_CLIENT_SECRET;
  const tenantId = process.env.AGENT365_TENANT_ID;

  if (!clientId || !clientSecret || !tenantId) {
    console.warn('[Agent365] AGENT365_ENABLED=true but AGENT365_CLIENT_ID, AGENT365_CLIENT_SECRET, or AGENT365_TENANT_ID missing. Skipping.');
    return [];
  }

  try {
    const bridge = await initAgent365Bridge({
      clientId,
      clientSecret,
      tenantId,
    }, serverFilter ?? [...STANDARD_M365_SERVERS]);

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
