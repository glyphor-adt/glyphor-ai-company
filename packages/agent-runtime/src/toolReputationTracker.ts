/**
 * Tool Reputation Tracker — Records per-call stats to the tool_reputation table.
 *
 * Every tool execution (static, runtime, dynamic, MCP) is tracked via the
 * Postgres `update_tool_stats()` function for reliability scoring.
 * All calls are fire-and-forget to avoid blocking tool execution.
 */

import { systemQuery } from '@glyphor/shared/db';
import { isKnownToolAsync } from './toolRegistry.js';

export type ToolSource = 'static' | 'runtime' | 'dynamic_registry' | 'mcp';

// ─── Source Detection ───────────────────────────────────────────

/** Cache of dynamic registry tool names to avoid repeated DB lookups. */
let _dynamicToolCache: Set<string> = new Set();
let _dynamicToolCacheExpiry = 0;
const DYNAMIC_CACHE_TTL = 120_000; // 2 minutes

async function refreshDynamicCache(): Promise<void> {
  if (Date.now() < _dynamicToolCacheExpiry) return;
  try {
    const rows = await systemQuery<{ name: string }>(
      'SELECT name FROM tool_registry WHERE is_active = true',
      [],
    );
    _dynamicToolCache = new Set(rows.map(r => r.name));
    _dynamicToolCacheExpiry = Date.now() + DYNAMIC_CACHE_TTL;
  } catch {
    // Keep stale cache on error
  }
}

/**
 * Detect the source category for a tool based on naming conventions
 * and dynamic registry membership.
 */
export function detectToolSource(toolName: string): ToolSource {
  if (toolName.startsWith('runtime_')) return 'runtime';
  if (toolName.startsWith('mcp_') || toolName.startsWith('glyphor_')) return 'mcp';
  if (_dynamicToolCache.has(toolName)) return 'dynamic_registry';
  return 'static';
}

// ─── Recording ──────────────────────────────────────────────────

/**
 * Record a single tool call outcome to the tool_reputation table.
 * Uses the Postgres `update_tool_stats()` function for atomic upsert.
 *
 * This MUST be called fire-and-forget (.catch()) — never await in the
 * tool execution hot path.
 */
export async function recordToolCall(
  toolName: string,
  toolSource: ToolSource,
  success: boolean,
  timedOut: boolean,
  latencyMs: number,
): Promise<void> {
  await systemQuery(
    'SELECT update_tool_stats($1, $2, $3, $4, $5)',
    [toolName, toolSource, success, timedOut, latencyMs],
  );
}

/**
 * Increment downstream_defect_count for tools used in a revised task run.
 * Called from the batch outcome evaluator when was_revised = true.
 */
export async function incrementDownstreamDefects(toolNames: string[]): Promise<void> {
  if (toolNames.length === 0) return;
  await systemQuery(
    `UPDATE tool_reputation
     SET downstream_defect_count = downstream_defect_count + 1, updated_at = NOW()
     WHERE tool_name = ANY($1::text[])`,
    [toolNames],
  );
}

// Warm the dynamic cache on module load (fire-and-forget)
refreshDynamicCache().catch(() => {});
