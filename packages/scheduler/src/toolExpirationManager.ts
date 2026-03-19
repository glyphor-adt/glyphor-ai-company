/**
 * Tool Expiration Manager — Auto-expire stale/unreliable dynamic tools
 *
 * Runs daily at 6 AM UTC to compute reliability scores and expire
 * dynamic/runtime tools that are stale, unreliable, timeout-prone,
 * or defect-prone. NEVER expires static or MCP tools.
 *
 * Expiration Rules (runtime & dynamic_registry only):
 *  - last_used_at < 7 days ago             → stale
 *  - success_rate < 0.5 AND total_calls≥10 → unreliable
 *  - timeout_calls > 5 AND ratio > 0.3     → timeout_prone
 *  - defects > 3 AND ratio > 0.2           → defect_prone
 */

import { systemQuery } from '@glyphor/shared/db';
import { getRedisCache, GlyphorEventBus } from '@glyphor/agent-runtime';
import type { GlyphorEventType } from '@glyphor/agent-runtime';

// ─── Types ──────────────────────────────────────────────────────

export interface ExpirationReport {
  expired: string[];
  reasons: Record<string, string>;
  reliability_updated: number;
}

interface ToolReputationRow {
  tool_name: string;
  tool_source: string;
  total_calls: number;
  success_rate: number | null;
  timeout_calls: number;
  downstream_defect_count: number;
  last_used_at: string | null;
  reliability_score: number | null;
}

// ─── Configuration ──────────────────────────────────────────────

const LOCK_KEY = 'tool-expiration-lock';
const LOCK_TTL_SECONDS = 15 * 60; // 15 minutes
const LOG_PREFIX = '[ToolExpirationManager]';

const ELIGIBLE_SOURCES = ['runtime', 'dynamic_registry'];
const STALE_DAYS = 7;
const MIN_CALLS_FOR_UNRELIABLE = 10;
const UNRELIABLE_THRESHOLD = 0.5;
const TIMEOUT_MIN_COUNT = 5;
const TIMEOUT_RATIO_THRESHOLD = 0.3;
const DEFECT_MIN_COUNT = 3;
const DEFECT_RATIO_THRESHOLD = 0.2;

// ─── Main Entry Point ───────────────────────────────────────────

export async function expireTools(eventBus?: GlyphorEventBus): Promise<ExpirationReport> {
  const report: ExpirationReport = {
    expired: [],
    reasons: {},
    reliability_updated: 0,
  };

  // Acquire Redis lock to prevent concurrent runs
  const cache = getRedisCache();
  const existingLock = await cache.get<string>(LOCK_KEY);
  if (existingLock) {
    console.log(`${LOG_PREFIX} Skipping — another expiration check is in progress`);
    return report;
  }
  await cache.set(LOCK_KEY, new Date().toISOString(), LOCK_TTL_SECONDS);

  try {
    // Step 1: Compute reliability_score for all active dynamic/runtime tools
    await updateReliabilityScores(report);

    // Step 2: Find and expire tools that meet expiration criteria
    await applyExpirationRules(report, eventBus);

    console.log(`${LOG_PREFIX} Complete:`, JSON.stringify(report));
  } finally {
    await cache.del(LOCK_KEY);
  }

  return report;
}

// ─── Step 1: Update Reliability Scores ──────────────────────────

async function updateReliabilityScores(report: ExpirationReport): Promise<void> {
  // Compute reliability for ALL active tools with usage (not just runtime/dynamic)
  // so the dashboard shows accurate health metrics for static & MCP tools too.
  const result = await systemQuery<{ count: number }>(
    `WITH updated AS (
       UPDATE tool_reputation SET
         reliability_score = (
           COALESCE(success_rate, 0) * 0.4
           + LEAST(1.0, 1.0 - (downstream_defect_count::numeric / GREATEST(total_calls, 1))) * 0.3
           + LEAST(1.0, 1.0 - (timeout_calls::numeric / GREATEST(total_calls, 1))) * 0.2
           + CASE WHEN last_used_at > NOW() - INTERVAL '7 days' THEN 0.1 ELSE 0.0 END
         ),
         updated_at = NOW()
       WHERE is_active = true
         AND total_calls > 0
       RETURNING 1
     )
     SELECT COUNT(*)::int AS count FROM updated`,
    [],
  );

  report.reliability_updated = result[0]?.count ?? 0;
  console.log(`${LOG_PREFIX} Step 1: Updated reliability scores for ${report.reliability_updated} tools`);
}

// ─── Step 2: Apply Expiration Rules ─────────────────────────────

async function applyExpirationRules(report: ExpirationReport, eventBus?: GlyphorEventBus): Promise<void> {
  // Fetch all active runtime/dynamic_registry tools
  const tools = await systemQuery<ToolReputationRow>(
    `SELECT tool_name, tool_source, total_calls, success_rate,
            timeout_calls, downstream_defect_count, last_used_at,
            reliability_score
     FROM tool_reputation
     WHERE tool_source IN ('runtime', 'dynamic_registry')
       AND is_active = true`,
    [],
  );

  if (tools.length === 0) {
    console.log(`${LOG_PREFIX} Step 2: No active dynamic/runtime tools to evaluate`);
    return;
  }

  for (const tool of tools) {
    const reason = determineExpirationReason(tool);
    if (!reason) continue;

    try {
      await expireTool(tool, reason);
      report.expired.push(tool.tool_name);
      report.reasons[tool.tool_name] = reason;
      await emitExpirationEvent(eventBus, tool, reason);
    } catch (err) {
      console.warn(`${LOG_PREFIX} Failed to expire ${tool.tool_name}:`, (err as Error).message);
    }
  }
}

// ─── Expiration Reason Logic ────────────────────────────────────

function determineExpirationReason(tool: ToolReputationRow): string | null {
  const { total_calls, success_rate, timeout_calls, downstream_defect_count, last_used_at } = tool;

  // Stale: not used in 7 days
  if (last_used_at) {
    const daysSinceUse = (Date.now() - new Date(last_used_at).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceUse > STALE_DAYS) return 'stale';
  } else {
    // Never used — treat as stale
    return 'stale';
  }

  // Unreliable: low success rate with sufficient calls
  if ((success_rate ?? 0) < UNRELIABLE_THRESHOLD && total_calls >= MIN_CALLS_FOR_UNRELIABLE) {
    return 'unreliable';
  }

  // Timeout-prone
  if (timeout_calls > TIMEOUT_MIN_COUNT && total_calls > 0 && (timeout_calls / total_calls) > TIMEOUT_RATIO_THRESHOLD) {
    return 'timeout_prone';
  }

  // Defect-prone
  if (downstream_defect_count > DEFECT_MIN_COUNT && total_calls > 0 && (downstream_defect_count / total_calls) > DEFECT_RATIO_THRESHOLD) {
    return 'defect_prone';
  }

  return null;
}

// ─── Expire a Single Tool ───────────────────────────────────────

async function expireTool(tool: ToolReputationRow, reason: string): Promise<void> {
  // Mark as expired in tool_reputation
  await systemQuery(
    `UPDATE tool_reputation
     SET is_active = false, expired_at = NOW(), expiration_reason = $1, updated_at = NOW()
     WHERE tool_name = $2`,
    [reason, tool.tool_name],
  );

  // Deactivate in tool_registry for dynamic tools
  await systemQuery(
    `UPDATE tool_registry SET is_active = false, updated_at = NOW() WHERE name = $1`,
    [tool.tool_name],
  );

  // Log to activity_log
  await logActivity(
    'tool.expired',
    `Tool "${tool.tool_name}" (${tool.tool_source}) expired: ${reason} — reliability=${tool.reliability_score ?? 'n/a'}, success_rate=${tool.success_rate ?? 'n/a'}`,
  );

  console.log(`${LOG_PREFIX} Expired tool "${tool.tool_name}": ${reason}`);
}

// ─── Helpers ────────────────────────────────────────────────────

async function logActivity(action: string, detail: string): Promise<void> {
  try {
    await systemQuery(
      'INSERT INTO activity_log (agent_role, action, summary) VALUES ($1,$2,$3)',
      ['system', action, detail],
    );
  } catch (err) {
    console.warn(`${LOG_PREFIX} Activity log failed:`, (err as Error).message);
  }
}

async function emitExpirationEvent(
  eventBus: GlyphorEventBus | undefined,
  tool: ToolReputationRow,
  reason: string,
): Promise<void> {
  if (!eventBus) return;
  const eventType: GlyphorEventType = 'alert.triggered';
  try {
    await eventBus.emit({
      type: eventType,
      source: 'system',
      payload: {
        action: 'tool.expired',
        tool_name: tool.tool_name,
        tool_source: tool.tool_source,
        reason,
        reliability_score: tool.reliability_score,
        severity: 'low',
      },
    });
  } catch (err) {
    console.warn(`${LOG_PREFIX} Event emission failed for ${tool.tool_name}:`, (err as Error).message);
  }
}
