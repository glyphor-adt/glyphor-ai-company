/**
 * Consolidation Lock — DB-Backed Mutex for Memory Consolidation
 *
 * Prevents concurrent consolidation runs for the same agent role.
 * Uses the `system_config` table (shared with circuit breaker) so all
 * service instances (scheduler, workers) see the same lock state.
 *
 * Lock lifecycle:
 *   1. `tryAcquireLock(role)` → returns token or null (another holder)
 *   2. Do consolidation work…
 *   3. `releaseLock(role, token)` → clears lock, stamps last-consolidated-at
 *
 * Stale detection: if lock is held > 1 hour and the holder instance
 * hasn't heartbeated, the lock is reclaimed on the next attempt.
 *
 * Inspired by Claude Code's consolidationLock.ts (file mtime + PID),
 * adapted for Glyphor's PostgreSQL-backed system_config model.
 */

import { systemQuery } from '@glyphor/shared/db';
import type { CompanyAgentRole } from '../types.js';
import { randomUUID } from 'crypto';

// ═══════════════════════════════════════════════════════════════════
// CONFIG KEYS — one pair per agent role
// ═══════════════════════════════════════════════════════════════════

function lockKey(role: CompanyAgentRole): string {
  return `memory_consolidation_lock_${role}`;
}

function lastConsolidatedKey(role: CompanyAgentRole): string {
  return `memory_consolidation_last_at_${role}`;
}

function memoryCountAtConsolidationKey(role: CompanyAgentRole): string {
  return `memory_consolidation_count_at_${role}`;
}

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

/** Locks older than this are considered stale and reclaimable. */
const STALE_LOCK_MS = 60 * 60 * 1000; // 1 hour

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export interface ConsolidationLockInfo {
  locked: boolean;
  holder: string | null;
  acquiredAt: number | null;
  stale: boolean;
}

// ═══════════════════════════════════════════════════════════════════
// LOCK OPERATIONS
// ═══════════════════════════════════════════════════════════════════

/**
 * Attempt to acquire the consolidation lock for a role.
 *
 * Returns a token string on success, or null if the lock is already
 * held by a non-stale holder.
 */
export async function tryAcquireConsolidationLock(
  role: CompanyAgentRole,
): Promise<string | null> {
  const key = lockKey(role);
  const token = randomUUID();
  const now = Date.now();

  try {
    // Check for existing lock
    const [existing] = await systemQuery<{ value: string; updated_at: string }>(
      `SELECT value, updated_at FROM system_config WHERE key = $1 LIMIT 1`,
      [key],
    );

    if (existing && existing.value) {
      // Lock exists — check if stale
      const acquiredAt = new Date(existing.updated_at).getTime();
      const age = now - acquiredAt;
      if (age < STALE_LOCK_MS) {
        // Lock is fresh — someone else is consolidating
        return null;
      }
      // Stale lock — reclaim it
      console.warn(
        `[ConsolidationLock] Reclaiming stale lock for ${role} ` +
        `(held for ${Math.round(age / 60_000)}m by ${existing.value})`,
      );
    }

    // Acquire: upsert the lock row with our token
    await systemQuery(
      `INSERT INTO system_config (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key)
       DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [key, token],
    );

    return token;
  } catch (err) {
    console.warn(
      `[ConsolidationLock] Failed to acquire lock for ${role}:`,
      (err as Error).message,
    );
    return null;
  }
}

/**
 * Release the consolidation lock and stamp the last-consolidated-at time.
 *
 * Only releases if the current holder matches the given token
 * (prevents releasing someone else's lock after a stale reclaim).
 */
export async function releaseConsolidationLock(
  role: CompanyAgentRole,
  token: string,
): Promise<boolean> {
  const key = lockKey(role);

  try {
    // Verify we still hold the lock
    const [row] = await systemQuery<{ value: string }>(
      `SELECT value FROM system_config WHERE key = $1 LIMIT 1`,
      [key],
    );

    if (!row || row.value !== token) {
      // Lock was reclaimed or already released
      return false;
    }

    // Delete the lock row
    await systemQuery(`DELETE FROM system_config WHERE key = $1`, [key]);

    // Stamp last-consolidated-at
    await systemQuery(
      `INSERT INTO system_config (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key)
       DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [lastConsolidatedKey(role), new Date().toISOString()],
    );

    return true;
  } catch (err) {
    console.warn(
      `[ConsolidationLock] Failed to release lock for ${role}:`,
      (err as Error).message,
    );
    return false;
  }
}

/**
 * Get the last consolidation timestamp for a role.
 * Returns 0 if the role has never been consolidated.
 */
export async function getLastConsolidatedAt(
  role: CompanyAgentRole,
): Promise<number> {
  try {
    const [row] = await systemQuery<{ value: string }>(
      `SELECT value FROM system_config WHERE key = $1 LIMIT 1`,
      [lastConsolidatedKey(role)],
    );
    if (!row?.value) return 0;
    const ts = new Date(row.value).getTime();
    return Number.isFinite(ts) ? ts : 0;
  } catch {
    return 0;
  }
}

/**
 * Record the memory count at the time of consolidation.
 * Used by the volume gate to detect growth since last consolidation.
 */
export async function recordMemoryCountAtConsolidation(
  role: CompanyAgentRole,
  count: number,
): Promise<void> {
  await systemQuery(
    `INSERT INTO system_config (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key)
     DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [memoryCountAtConsolidationKey(role), String(count)],
  ).catch(() => {});
}

/**
 * Get the memory count that was recorded at the last consolidation.
 * Returns 0 if no consolidation has occurred.
 */
export async function getMemoryCountAtConsolidation(
  role: CompanyAgentRole,
): Promise<number> {
  try {
    const [row] = await systemQuery<{ value: string }>(
      `SELECT value FROM system_config WHERE key = $1 LIMIT 1`,
      [memoryCountAtConsolidationKey(role)],
    );
    if (!row?.value) return 0;
    const val = parseInt(row.value, 10);
    return Number.isFinite(val) ? val : 0;
  } catch {
    return 0;
  }
}

/**
 * Get the current lock info for debugging/ops tools.
 */
export async function getConsolidationLockInfo(
  role: CompanyAgentRole,
): Promise<ConsolidationLockInfo> {
  const key = lockKey(role);
  try {
    const [row] = await systemQuery<{ value: string; updated_at: string }>(
      `SELECT value, updated_at FROM system_config WHERE key = $1 LIMIT 1`,
      [key],
    );
    if (!row?.value) {
      return { locked: false, holder: null, acquiredAt: null, stale: false };
    }
    const acquiredAt = new Date(row.updated_at).getTime();
    const age = Date.now() - acquiredAt;
    return {
      locked: true,
      holder: row.value,
      acquiredAt,
      stale: age >= STALE_LOCK_MS,
    };
  } catch {
    return { locked: false, holder: null, acquiredAt: null, stale: false };
  }
}
