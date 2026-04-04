/**
 * Global Circuit Breaker — Fleet-Wide Emergency Halt
 *
 * Provides a global kill switch that halts ALL agent execution when:
 *   - Fleet cost exceeds a daily ceiling (auto-trip)
 *   - A founder or ops agent manually triggers a halt
 *   - A critical behavioral anomaly cascade is detected
 *
 * Three halt levels:
 *   Level 1 (CAUTION):  Block new write tools only; reads continue
 *   Level 2 (HALT):     Block all tool execution; running turns complete
 *   Level 3 (EMERGENCY): Block all tool execution + abort running agents
 *
 * State is stored in the `system_config` table (shared DB) so ALL
 * service instances (scheduler, agent workers) see the same state.
 * Reads are cached with a short TTL to avoid per-tool-call DB queries.
 *
 * Usage:
 *
 *   // Check before tool execution:
 *   const status = await getHaltStatus();
 *   if (status.halted) { return { success: false, error: status.message }; }
 *
 *   // Trip the breaker:
 *   await tripCircuitBreaker({ level: 2, reason: 'Cost spike detected', triggeredBy: 'ops' });
 *
 *   // Clear the breaker:
 *   await clearCircuitBreaker('kristina', 'Cost reviewed and approved');
 */

import { systemQuery } from '@glyphor/shared/db';
import type { CompanyAgentRole } from './types.js';

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export type HaltLevel = 1 | 2 | 3;

export const HALT_LEVEL_NAMES: Record<HaltLevel, string> = {
  1: 'CAUTION',
  2: 'HALT',
  3: 'EMERGENCY',
};

export interface HaltStatus {
  /** Whether the fleet is currently halted. */
  halted: boolean;
  /** Halt level (1=caution, 2=halt, 3=emergency). Null if not halted. */
  level: HaltLevel | null;
  /** Human-readable reason for the halt. */
  reason: string | null;
  /** Who triggered the halt (agent role or founder name). */
  triggeredBy: string | null;
  /** When the halt was triggered (ISO string). */
  triggeredAt: string | null;
  /** Auto-clear time (ISO string). Null if no auto-clear. */
  expiresAt: string | null;
  /** Fleet daily cost at time of trip (USD). */
  fleetCostAtTrip: number | null;
  /** Which agents are affected. Empty = all agents. */
  affectedAgents: CompanyAgentRole[];
  /** User-facing message to inject into agent error responses. */
  message: string;
}

export interface TripOptions {
  level: HaltLevel;
  reason: string;
  triggeredBy: string;
  /** Auto-clear after this many hours. Null = manual clear required. */
  durationHours?: number | null;
  /** Restrict halt to specific agents. Empty/undefined = all agents. */
  affectedAgents?: CompanyAgentRole[];
  /** Fleet cost at time of trip (for audit trail). */
  fleetCostUsd?: number;
}

export interface ClearResult {
  cleared: boolean;
  previousLevel: HaltLevel | null;
  durationSeconds: number | null;
}

// ═══════════════════════════════════════════════════════════════════
// system_config KEYS
// ═══════════════════════════════════════════════════════════════════

const CONFIG_KEY_HALT_ACTIVE    = 'circuit_breaker_halt_active';
const CONFIG_KEY_HALT_LEVEL     = 'circuit_breaker_halt_level';
const CONFIG_KEY_HALT_REASON    = 'circuit_breaker_halt_reason';
const CONFIG_KEY_HALT_BY        = 'circuit_breaker_halt_triggered_by';
const CONFIG_KEY_HALT_AT        = 'circuit_breaker_halt_triggered_at';
const CONFIG_KEY_HALT_EXPIRES   = 'circuit_breaker_halt_expires_at';
const CONFIG_KEY_HALT_COST      = 'circuit_breaker_halt_fleet_cost';
const CONFIG_KEY_HALT_AGENTS    = 'circuit_breaker_halt_affected_agents';
const CONFIG_KEY_FLEET_CEILING  = 'circuit_breaker_fleet_daily_ceiling_usd';

// ═══════════════════════════════════════════════════════════════════
// CACHE — Short TTL to avoid DB queries on every tool call
// ═══════════════════════════════════════════════════════════════════

/** Cache TTL in milliseconds. 10 seconds balances freshness vs DB load. */
const CACHE_TTL_MS = 10_000;

let cachedStatus: HaltStatus | null = null;
let cachedAt = 0;

/** Force-invalidate the cache (call after trip/clear). */
export function invalidateHaltCache(): void {
  cachedStatus = null;
  cachedAt = 0;
}

// ═══════════════════════════════════════════════════════════════════
// READ — Check halt status
// ═══════════════════════════════════════════════════════════════════

/**
 * Get the current fleet halt status.
 * Cached for CACHE_TTL_MS to avoid per-tool-call DB queries.
 */
export async function getHaltStatus(): Promise<HaltStatus> {
  const now = Date.now();
  if (cachedStatus && now - cachedAt < CACHE_TTL_MS) {
    return cachedStatus;
  }

  try {
    const status = await fetchHaltStatusFromDb();
    cachedStatus = status;
    cachedAt = now;
    return status;
  } catch (err) {
    // On DB error, return not-halted (fail-open for availability).
    // A DB outage shouldn't stop all agents — that would be worse
    // than the condition the breaker is protecting against.
    console.warn('[CircuitBreaker] Failed to read halt status, assuming not halted:', (err as Error).message);
    return NOT_HALTED;
  }
}

/**
 * Check if a specific tool call should be blocked by the circuit breaker.
 * This is the fast path for ToolExecutor integration.
 */
export async function shouldBlockToolCall(
  toolName: string,
  agentRole: CompanyAgentRole,
): Promise<{ blocked: boolean; message: string }> {
  const status = await getHaltStatus();

  if (!status.halted) {
    return { blocked: false, message: '' };
  }

  // Check if this agent is affected
  if (status.affectedAgents.length > 0 && !status.affectedAgents.includes(agentRole)) {
    return { blocked: false, message: '' };
  }

  // Level 1 (CAUTION): only block write tools
  if (status.level === 1) {
    if (isReadOnlyToolName(toolName)) {
      return { blocked: false, message: '' };
    }
  }

  // Levels 2 and 3: block everything
  return {
    blocked: true,
    message: status.message,
  };
}

/**
 * Check if the heartbeat should skip agent dispatch entirely.
 * This is the fast path for scheduler integration.
 */
export async function shouldBlockHeartbeat(
  agentRole: CompanyAgentRole,
): Promise<{ blocked: boolean; reason: string }> {
  const status = await getHaltStatus();

  if (!status.halted || status.level === null) {
    return { blocked: false, reason: '' };
  }

  // Check if this agent is affected
  if (status.affectedAgents.length > 0 && !status.affectedAgents.includes(agentRole)) {
    return { blocked: false, reason: '' };
  }

  // All halt levels block new agent dispatches
  return {
    blocked: true,
    reason: `[CIRCUIT BREAKER] Fleet halted (${HALT_LEVEL_NAMES[status.level]}): ${status.reason ?? 'unknown'}`,
  };
}

// ═══════════════════════════════════════════════════════════════════
// WRITE — Trip / Clear the breaker
// ═══════════════════════════════════════════════════════════════════

/**
 * Trip the circuit breaker — halts fleet-wide tool execution.
 */
export async function tripCircuitBreaker(options: TripOptions): Promise<HaltStatus> {
  const now = new Date().toISOString();
  const expiresAt = options.durationHours
    ? new Date(Date.now() + options.durationHours * 3600_000).toISOString()
    : null;
  const affectedAgentsJson = options.affectedAgents?.length
    ? JSON.stringify(options.affectedAgents)
    : '[]';

  // Upsert all config keys atomically
  const pairs: [string, string][] = [
    [CONFIG_KEY_HALT_ACTIVE,  'true'],
    [CONFIG_KEY_HALT_LEVEL,   String(options.level)],
    [CONFIG_KEY_HALT_REASON,  options.reason],
    [CONFIG_KEY_HALT_BY,      options.triggeredBy],
    [CONFIG_KEY_HALT_AT,      now],
    [CONFIG_KEY_HALT_EXPIRES, expiresAt ?? ''],
    [CONFIG_KEY_HALT_COST,    String(options.fleetCostUsd ?? 0)],
    [CONFIG_KEY_HALT_AGENTS,  affectedAgentsJson],
  ];

  for (const [key, value] of pairs) {
    await upsertConfig(key, value);
  }

  // Write audit record
  await persistHaltEvent({
    action: 'trip',
    level: options.level,
    reason: options.reason,
    triggeredBy: options.triggeredBy,
    fleetCostUsd: options.fleetCostUsd ?? null,
    affectedAgents: options.affectedAgents ?? [],
  });

  invalidateHaltCache();

  const status = await getHaltStatus();
  console.warn(
    `[CircuitBreaker] TRIPPED: Level ${options.level} (${HALT_LEVEL_NAMES[options.level]}) ` +
    `by ${options.triggeredBy} — ${options.reason}`,
  );

  return status;
}

/**
 * Clear the circuit breaker — resumes fleet execution.
 */
export async function clearCircuitBreaker(
  clearedBy: string,
  reason?: string,
): Promise<ClearResult> {
  // Read current state before clearing
  const current = await fetchHaltStatusFromDb();

  if (!current.halted) {
    return { cleared: false, previousLevel: null, durationSeconds: null };
  }

  const durationSeconds = current.triggeredAt
    ? Math.round((Date.now() - new Date(current.triggeredAt).getTime()) / 1000)
    : null;

  // Set halt_active to false (keep other keys for audit trail)
  await upsertConfig(CONFIG_KEY_HALT_ACTIVE, 'false');

  // Write audit record
  await persistHaltEvent({
    action: 'clear',
    level: current.level!,
    reason: reason ?? `Cleared by ${clearedBy}`,
    triggeredBy: clearedBy,
    fleetCostUsd: current.fleetCostAtTrip,
    affectedAgents: current.affectedAgents,
    durationSeconds,
  });

  invalidateHaltCache();

  console.log(
    `[CircuitBreaker] CLEARED by ${clearedBy}. ` +
    `Was Level ${current.level} for ${durationSeconds ?? '?'}s.`,
  );

  return {
    cleared: true,
    previousLevel: current.level,
    durationSeconds,
  };
}

// ═══════════════════════════════════════════════════════════════════
// AUTO-TRIP — Fleet cost ceiling check
// ═══════════════════════════════════════════════════════════════════

/**
 * Check if the fleet's total daily cost exceeds the configured ceiling.
 * If so, auto-trip the circuit breaker at Level 2 (HALT).
 *
 * Call this from the heartbeat cycle or a periodic CRON job.
 * Returns the trip status (null if no trip was needed).
 */
export async function checkFleetCostCeiling(): Promise<HaltStatus | null> {
  // Don't re-trip if already halted
  const current = await getHaltStatus();
  if (current.halted) return null;

  const ceiling = await getFleetDailyCeiling();
  if (ceiling === null || ceiling <= 0) return null;

  const fleetCost = await getFleetDailyCost();
  if (fleetCost < ceiling) return null;

  // Auto-trip at Level 2
  console.warn(
    `[CircuitBreaker] AUTO-TRIP: Fleet daily cost $${fleetCost.toFixed(2)} >= ceiling $${ceiling.toFixed(2)}`,
  );

  return tripCircuitBreaker({
    level: 2,
    reason: `Fleet daily cost ($${fleetCost.toFixed(2)}) exceeded ceiling ($${ceiling.toFixed(2)})`,
    triggeredBy: 'auto:cost_ceiling',
    durationHours: 4, // Auto-clear after 4 hours (founders can clear sooner)
    fleetCostUsd: fleetCost,
  });
}

// ═══════════════════════════════════════════════════════════════════
// INTERNAL HELPERS
// ═══════════════════════════════════════════════════════════════════

const NOT_HALTED: HaltStatus = {
  halted: false,
  level: null,
  reason: null,
  triggeredBy: null,
  triggeredAt: null,
  expiresAt: null,
  fleetCostAtTrip: null,
  affectedAgents: [],
  message: '',
};

async function fetchHaltStatusFromDb(): Promise<HaltStatus> {
  const keys = [
    CONFIG_KEY_HALT_ACTIVE,
    CONFIG_KEY_HALT_LEVEL,
    CONFIG_KEY_HALT_REASON,
    CONFIG_KEY_HALT_BY,
    CONFIG_KEY_HALT_AT,
    CONFIG_KEY_HALT_EXPIRES,
    CONFIG_KEY_HALT_COST,
    CONFIG_KEY_HALT_AGENTS,
  ];

  const rows = await systemQuery<{ key: string; value: string }>(
    `SELECT key, value FROM system_config WHERE key = ANY($1)`,
    [keys],
  );

  const cfg = new Map(rows.map(r => [r.key, r.value]));
  const active = cfg.get(CONFIG_KEY_HALT_ACTIVE) === 'true';

  if (!active) {
    // Check for expired halt (auto-clear)
    return NOT_HALTED;
  }

  // Check expiration
  const expiresAt = cfg.get(CONFIG_KEY_HALT_EXPIRES) || null;
  if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) {
    // Auto-expired — clear it
    await upsertConfig(CONFIG_KEY_HALT_ACTIVE, 'false');
    await persistHaltEvent({
      action: 'auto_expire',
      level: parseHaltLevel(cfg.get(CONFIG_KEY_HALT_LEVEL)),
      reason: 'Auto-expired after duration elapsed',
      triggeredBy: 'auto:expiration',
      fleetCostUsd: parseFloat(cfg.get(CONFIG_KEY_HALT_COST) ?? '0') || null,
      affectedAgents: parseAffectedAgents(cfg.get(CONFIG_KEY_HALT_AGENTS)),
    });
    return NOT_HALTED;
  }

  const level = parseHaltLevel(cfg.get(CONFIG_KEY_HALT_LEVEL));
  const reason = cfg.get(CONFIG_KEY_HALT_REASON) ?? null;
  const triggeredBy = cfg.get(CONFIG_KEY_HALT_BY) ?? null;
  const triggeredAt = cfg.get(CONFIG_KEY_HALT_AT) ?? null;
  const fleetCostAtTrip = parseFloat(cfg.get(CONFIG_KEY_HALT_COST) ?? '0') || null;
  const affectedAgents = parseAffectedAgents(cfg.get(CONFIG_KEY_HALT_AGENTS));

  return {
    halted: true,
    level,
    reason,
    triggeredBy,
    triggeredAt,
    expiresAt: expiresAt || null,
    fleetCostAtTrip,
    affectedAgents,
    message:
      `[CIRCUIT BREAKER — ${HALT_LEVEL_NAMES[level ?? 2]}] Fleet execution halted. ` +
      `Reason: ${reason ?? 'unknown'}. Triggered by: ${triggeredBy ?? 'unknown'}. ` +
      `Contact a founder to resume operations.`,
  };
}

function parseHaltLevel(raw: string | undefined): HaltLevel {
  const n = parseInt(raw ?? '2', 10);
  if (n === 1 || n === 2 || n === 3) return n;
  return 2;
}

function parseAffectedAgents(raw: string | undefined): CompanyAgentRole[] {
  if (!raw || raw === '[]') return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as CompanyAgentRole[];
  } catch { /* ignore */ }
  return [];
}

/** Read-only tool heuristic: tools starting with common read prefixes. */
const READ_ONLY_PREFIXES = [
  'get_', 'read_', 'calculate_', 'recall_', 'query_', 'search_',
  'check_', 'fetch_', 'discover_', 'monitor_', 'list_',
];

function isReadOnlyToolName(name: string): boolean {
  return READ_ONLY_PREFIXES.some(p => name.startsWith(p));
}

async function upsertConfig(key: string, value: string): Promise<void> {
  await systemQuery(
    `INSERT INTO system_config (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key)
     DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, value],
  );
}

async function getFleetDailyCeiling(): Promise<number | null> {
  try {
    const [row] = await systemQuery<{ value: string }>(
      `SELECT value FROM system_config WHERE key = $1 LIMIT 1`,
      [CONFIG_KEY_FLEET_CEILING],
    );
    if (!row) return null;
    const val = parseFloat(row.value);
    return Number.isFinite(val) ? val : null;
  } catch {
    return null;
  }
}

async function getFleetDailyCost(): Promise<number> {
  try {
    const [row] = await systemQuery<{ total: string }>(
      `SELECT COALESCE(SUM(total_cost_usd), 0)::text AS total
       FROM agent_runs
       WHERE created_at >= date_trunc('day', NOW() AT TIME ZONE 'America/Chicago')`,
      [],
    );
    return parseFloat(row?.total ?? '0');
  } catch {
    return 0;
  }
}

// ── Audit Trail ────────────────────────────────────────────────

interface HaltEventRecord {
  action: 'trip' | 'clear' | 'auto_expire';
  level: HaltLevel | null;
  reason: string;
  triggeredBy: string;
  fleetCostUsd: number | null;
  affectedAgents: CompanyAgentRole[];
  durationSeconds?: number | null;
}

async function persistHaltEvent(record: HaltEventRecord): Promise<void> {
  try {
    await systemQuery(
      `INSERT INTO activity_log (
         agent_role, agent_id, action, activity_type,
         summary, description, details, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
      [
        'ops',
        record.triggeredBy,
        `circuit_breaker_${record.action}`,
        'system_event',
        `Circuit breaker ${record.action}: Level ${record.level ?? '?'} (${HALT_LEVEL_NAMES[record.level ?? 2]})`,
        record.reason,
        JSON.stringify({
          level: record.level,
          fleet_cost_usd: record.fleetCostUsd,
          affected_agents: record.affectedAgents,
          duration_seconds: record.durationSeconds ?? null,
        }),
        new Date().toISOString(),
      ],
    );
  } catch (err) {
    console.warn('[CircuitBreaker] Failed to persist audit event:', (err as Error).message);
  }
}

// ═══════════════════════════════════════════════════════════════════
// FLEET COST SUMMARY (for dashboard / monitoring)
// ═══════════════════════════════════════════════════════════════════

export interface FleetCostSummary {
  totalDailyUsd: number;
  ceilingUsd: number | null;
  utilizationPct: number | null;
  topAgents: { role: string; costUsd: number }[];
}

/**
 * Get a snapshot of fleet cost usage for dashboard display.
 */
export async function getFleetCostSummary(): Promise<FleetCostSummary> {
  const [totalRow] = await systemQuery<{ total: string }>(
    `SELECT COALESCE(SUM(total_cost_usd), 0)::text AS total
     FROM agent_runs
     WHERE created_at >= date_trunc('day', NOW() AT TIME ZONE 'America/Chicago')`,
    [],
  );
  const totalDailyUsd = parseFloat(totalRow?.total ?? '0');
  const ceilingUsd = await getFleetDailyCeiling();

  const topAgentRows = await systemQuery<{ agent_id: string; cost: string }>(
    `SELECT agent_id, COALESCE(SUM(total_cost_usd), 0)::text AS cost
     FROM agent_runs
     WHERE created_at >= date_trunc('day', NOW() AT TIME ZONE 'America/Chicago')
     GROUP BY agent_id
     ORDER BY SUM(total_cost_usd) DESC
     LIMIT 5`,
    [],
  );

  return {
    totalDailyUsd,
    ceilingUsd,
    utilizationPct: ceilingUsd ? Math.round((totalDailyUsd / ceilingUsd) * 100) : null,
    topAgents: topAgentRows.map(r => ({ role: r.agent_id, costUsd: parseFloat(r.cost) })),
  };
}
