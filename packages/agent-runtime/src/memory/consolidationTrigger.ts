/**
 * Consolidation Trigger — Gate-Based Auto-Dream Dispatch
 *
 * Evaluates whether an agent's memories should be consolidated,
 * using a cheapest-first gate cascade (inspired by Claude Code):
 *
 *   Gate 1 – Time:   >= 24 hours since last consolidation
 *   Gate 2 – Volume: >= 20 new memories since last consolidation
 *   Gate 3 – Lock:   Consolidation lock is available
 *
 * If all gates pass, the consolidation pipeline is dispatched
 * fire-and-forget (non-blocking to the agent's main loop).
 *
 * Call `maybeConsolidate()` at the end of every successful agent run.
 * It returns immediately if any gate fails (< 1ms hot path).
 */

import type { CompanyAgentRole } from '../types.js';
import type { AgentMemoryStore } from '../companyAgentRunner.js';
import type { ModelClient } from '../modelClient.js';
import {
  getLastConsolidatedAt,
  getMemoryCountAtConsolidation,
  getConsolidationLockInfo,
} from './consolidationLock.js';
import { runConsolidation, type ConsolidationConfig, type ConsolidationResult } from './memoryConsolidation.js';

// ═══════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════

export interface ConsolidationTriggerConfig {
  /** Minimum hours between consolidations. Default: 24. */
  minHoursBetween: number;
  /** Minimum new memories since last consolidation. Default: 20. */
  minNewMemories: number;
  /** Enable/disable the trigger entirely. Default: true. */
  enabled: boolean;
}

const DEFAULT_TRIGGER_CONFIG: ConsolidationTriggerConfig = {
  minHoursBetween: 24,
  minNewMemories: 20,
  enabled: true,
};

/**
 * Read trigger config from environment variables (with defaults).
 */
export function getConsolidationTriggerConfigFromEnv(): ConsolidationTriggerConfig {
  return {
    enabled: process.env.MEMORY_CONSOLIDATION_ENABLED !== 'false',
    minHoursBetween: parseInt(process.env.MEMORY_CONSOLIDATION_MIN_HOURS ?? '24', 10) || 24,
    minNewMemories: parseInt(process.env.MEMORY_CONSOLIDATION_MIN_MEMORIES ?? '20', 10) || 20,
  };
}

// ═══════════════════════════════════════════════════════════════════
// GATE EVALUATION
// ═══════════════════════════════════════════════════════════════════

export interface GateResult {
  passed: boolean;
  reason: string;
  gate: 'disabled' | 'time' | 'volume' | 'lock' | 'all_passed';
  hoursSinceLast?: number;
  newMemoryCount?: number;
}

/**
 * Evaluate all gates (cheapest-first) without acquiring the lock.
 * Useful for debugging/ops visibility.
 */
export async function evaluateGates(
  role: CompanyAgentRole,
  store: AgentMemoryStore,
  triggerConfig?: Partial<ConsolidationTriggerConfig>,
): Promise<GateResult> {
  const config = { ...DEFAULT_TRIGGER_CONFIG, ...triggerConfig };

  // Gate 0: Enabled check (free)
  if (!config.enabled) {
    return { passed: false, reason: 'Consolidation disabled', gate: 'disabled' };
  }

  // Gate 1: Time (1 DB query)
  const lastAt = await getLastConsolidatedAt(role);
  const hoursSinceLast = lastAt > 0
    ? (Date.now() - lastAt) / 3_600_000
    : Infinity;

  if (hoursSinceLast < config.minHoursBetween) {
    return {
      passed: false,
      reason: `Only ${hoursSinceLast.toFixed(1)}h since last consolidation (need ${config.minHoursBetween}h)`,
      gate: 'time',
      hoursSinceLast,
    };
  }

  // Gate 2: Volume (2 DB queries — memory count + count at last consolidation)
  const currentMemories = await store.getMemories(role, { limit: 500 });
  const countAtLast = await getMemoryCountAtConsolidation(role);
  const newMemoryCount = currentMemories.length - countAtLast;

  if (newMemoryCount < config.minNewMemories && lastAt > 0) {
    return {
      passed: false,
      reason: `Only ${newMemoryCount} new memories since last consolidation (need ${config.minNewMemories})`,
      gate: 'volume',
      hoursSinceLast,
      newMemoryCount,
    };
  }

  // Gate 3: Lock availability (1 DB query)
  const lockInfo = await getConsolidationLockInfo(role);
  if (lockInfo.locked && !lockInfo.stale) {
    return {
      passed: false,
      reason: `Lock held by ${lockInfo.holder} (acquired ${Math.round((Date.now() - (lockInfo.acquiredAt ?? 0)) / 60_000)}m ago)`,
      gate: 'lock',
      hoursSinceLast,
      newMemoryCount,
    };
  }

  return {
    passed: true,
    reason: 'All gates passed',
    gate: 'all_passed',
    hoursSinceLast,
    newMemoryCount,
  };
}

// ═══════════════════════════════════════════════════════════════════
// TRIGGER
// ═══════════════════════════════════════════════════════════════════

/**
 * Check gates and dispatch consolidation if all pass.
 *
 * This is the main entry point — call at the end of every successful
 * agent run. It is non-blocking: the consolidation runs async
 * (fire-and-forget) and any errors are caught and logged.
 *
 * @param role         - The agent role that just completed a run
 * @param store        - Memory store for reading memories
 * @param modelClient  - Model client for LLM consolidation calls
 * @param triggerConfig - Optional trigger config overrides
 * @param consolidationConfig - Optional pipeline config overrides
 * @returns Whether consolidation was dispatched (does not wait for completion)
 */
export async function maybeConsolidate(
  role: CompanyAgentRole,
  store: AgentMemoryStore,
  modelClient: ModelClient,
  triggerConfig?: Partial<ConsolidationTriggerConfig>,
  consolidationConfig?: Partial<ConsolidationConfig>,
): Promise<boolean> {
  try {
    const gates = await evaluateGates(role, store, triggerConfig);
    if (!gates.passed) return false;

    // Dispatch fire-and-forget — don't block the caller
    runConsolidation(role, store, modelClient, consolidationConfig)
      .then(result => {
        if (result.success) {
          console.log(
            `[ConsolidationTrigger] ${role} completed: ` +
            `merged=${result.merged} pruned=${result.pruned} ` +
            `synthesized=${result.synthesized} remaining=${result.remainingCount} ` +
            `(${result.durationMs}ms)`,
          );
        } else {
          console.warn(
            `[ConsolidationTrigger] ${role} failed: ${result.error}`,
          );
        }
      })
      .catch(err => {
        console.error(
          `[ConsolidationTrigger] Unhandled error for ${role}:`,
          (err as Error).message,
        );
      });

    return true;
  } catch (err) {
    console.warn(
      `[ConsolidationTrigger] Gate evaluation failed for ${role}:`,
      (err as Error).message,
    );
    return false;
  }
}

/**
 * Run consolidation synchronously (blocking). Used for manual triggers
 * from ops tools or debugging — NOT for the normal post-run path.
 */
export async function forceConsolidate(
  role: CompanyAgentRole,
  store: AgentMemoryStore,
  modelClient: ModelClient,
  consolidationConfig?: Partial<ConsolidationConfig>,
): Promise<ConsolidationResult> {
  return runConsolidation(role, store, modelClient, consolidationConfig);
}
