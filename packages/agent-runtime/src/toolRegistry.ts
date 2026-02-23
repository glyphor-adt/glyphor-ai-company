/**
 * Tool Registry — Central lookup for tool names.
 *
 * Maps tool names (from skills.tools_granted) to a flag indicating
 * the tool exists in the system. Agents' run.ts files already assemble
 * full ToolDefinition[] arrays; this registry lets the skill system
 * verify which tools are available without importing every tool module.
 */

/** All known tool names in the system. */
const KNOWN_TOOLS = new Set([
  // ── Shared tools (all agents) ──
  'save_memory',
  'recall_memories',
  'search_memories',

  // ── Collective Intelligence tools ──
  'get_company_pulse',
  'contribute_knowledge',
  'get_org_knowledge',

  // ── Graph tools ──
  'query_knowledge_graph',
  'add_graph_node',
  'add_graph_edge',

  // ── Communication tools ──
  'send_agent_message',
  'reply_to_message',
  'call_meeting',

  // ── Decision tools ──
  'file_decision',

  // ── Data query tools ──
  'query_financials',
  'query_costs',
  'query_customers',

  // ── Engineering tools ──
  'check_system_health',
  'query_logs',
  'read_file',

  // ── External tools ──
  'web_search',
]);

/**
 * Check whether a tool name is known to the system.
 */
export function isKnownTool(name: string): boolean {
  return KNOWN_TOOLS.has(name);
}

/**
 * Filter a list of tool names to only those that exist in the system.
 */
export function filterKnownTools(toolNames: string[]): string[] {
  return toolNames.filter((n) => KNOWN_TOOLS.has(n));
}

/**
 * Get all known tool names.
 */
export function getAllKnownTools(): string[] {
  return [...KNOWN_TOOLS];
}
