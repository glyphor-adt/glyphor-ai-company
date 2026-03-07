/**
 * Memory Archiver — Weekly TTL-based archival of expired raw traces
 *
 * Runs weekly (Sunday 4 AM UTC) to archive expired memories from
 * source tables into cold storage (memory_archive) and purge
 * expired archive entries.
 *
 * Retention rules vary by source table and significance level.
 * Records at the 'operative' layer are never automatically archived.
 */

import { systemQuery } from '@glyphor/shared/db';
import { getRedisCache } from '@glyphor/agent-runtime';

// ─── Types ──────────────────────────────────────────────────────

export interface ArchivalReport {
  archived: number;
  deleted_expired: number;
  errors: number;
  details: Array<{ source_table: string; count: number }>;
}

interface RetentionRule {
  source_table: string;
  raw_retention_days: number;
  archive_retention_days: number;
  condition?: string;           // additional WHERE clause for the source query
  condition_params?: unknown[]; // params for the condition clause (appended after standard params)
}

// ─── Configuration ──────────────────────────────────────────────

const LOCK_KEY = 'memory-archival-lock';
const LOCK_TTL_SECONDS = 30 * 60; // 30 minutes
const BATCH_SIZE = 100;

const RETENTION_RULES: RetentionRule[] = [
  {
    source_table: 'agent_runs',
    raw_retention_days: 30,
    archive_retention_days: 180,
  },
  {
    source_table: 'agent_reflections',
    raw_retention_days: 30,
    archive_retention_days: 90,
  },
  {
    source_table: 'agent_memory',
    raw_retention_days: 60,
    archive_retention_days: 180,
  },
  {
    source_table: 'shared_episodes',
    raw_retention_days: 30,
    archive_retention_days: 90,
    condition: 'AND t.significance_score < $NEXT',
    condition_params: [0.5],
  },
  {
    source_table: 'shared_episodes',
    raw_retention_days: 90,
    archive_retention_days: 180,
    condition: 'AND t.significance_score >= $NEXT',
    condition_params: [0.5],
  },
  {
    source_table: 'agent_messages',
    raw_retention_days: 14,
    archive_retention_days: 60,
  },
  {
    source_table: 'task_run_outcomes',
    raw_retention_days: 60,
    archive_retention_days: 180,
  },
];

// ─── Main Entry Point ───────────────────────────────────────────

export async function archiveExpiredMemory(): Promise<ArchivalReport> {
  const report: ArchivalReport = {
    archived: 0,
    deleted_expired: 0,
    errors: 0,
    details: [],
  };

  // Acquire Redis lock to prevent concurrent runs
  const cache = getRedisCache();
  const existingLock = await cache.get<string>(LOCK_KEY);
  if (existingLock) {
    console.log('[MemoryArchiver] Skipping — another archival is in progress');
    return report;
  }
  await cache.set(LOCK_KEY, new Date().toISOString(), LOCK_TTL_SECONDS);

  try {
    // PHASE 1: Archive expired records from each source table
    for (const rule of RETENTION_RULES) {
      try {
        const count = await archiveByRule(rule);
        if (count > 0) {
          report.archived += count;
          // Merge into details (same source_table may appear twice for shared_episodes)
          const existing = report.details.find(d => d.source_table === rule.source_table);
          if (existing) {
            existing.count += count;
          } else {
            report.details.push({ source_table: rule.source_table, count });
          }
        }
      } catch (err) {
        console.error(
          `[MemoryArchiver] Error archiving ${rule.source_table}:`,
          (err as Error).message,
        );
        report.errors++;
      }
    }

    // PHASE 2: Purge expired archive entries
    try {
      const purged = await purgeExpiredArchives();
      report.deleted_expired = purged;
    } catch (err) {
      console.error('[MemoryArchiver] Error purging expired archives:', (err as Error).message);
      report.errors++;
    }

    console.log('[MemoryArchiver] Complete:', JSON.stringify(report));
  } finally {
    await cache.del(LOCK_KEY);
  }

  return report;
}

// ─── Phase 1: Archive by Retention Rule ─────────────────────────

async function archiveByRule(rule: RetentionRule): Promise<number> {
  let totalArchived = 0;
  const cutoffDate = new Date(
    Date.now() - rule.raw_retention_days * 24 * 60 * 60 * 1000,
  ).toISOString();

  // Build the condition clause with correct parameter numbering
  let conditionClause = '';
  const baseParams: unknown[] = [rule.source_table, cutoffDate];
  if (rule.condition && rule.condition_params) {
    // Replace $NEXT placeholders with sequential param numbers starting after base params
    let paramIdx = baseParams.length + 1;
    conditionClause = rule.condition.replace(/\$NEXT/g, () => `$${paramIdx++}`);
    baseParams.push(...rule.condition_params);
  }

  // Process in batches
  let hasMore = true;
  while (hasMore) {
    const candidates = await systemQuery<{ id: string }>(
      `SELECT t.id
       FROM ${rule.source_table} t
       LEFT JOIN memory_lifecycle ml
         ON ml.source_table = $1 AND ml.source_id = t.id
       WHERE t.created_at < $2
         AND (ml.id IS NULL OR ml.current_layer IN ('raw', 'distilled'))
         AND ml.current_layer IS DISTINCT FROM 'operative'
         ${conditionClause}
         ${getActiveReferenceExclusion(rule.source_table)}
       ORDER BY t.created_at ASC
       LIMIT ${BATCH_SIZE}`,
      baseParams,
    );

    if (candidates.length === 0) {
      hasMore = false;
      break;
    }

    const batchIds = candidates.map(c => c.id);
    try {
      const archived = await archiveBatch(rule, batchIds);
      totalArchived += archived;
    } catch (err) {
      console.error(
        `[MemoryArchiver] Batch error for ${rule.source_table}:`,
        (err as Error).message,
      );
      // Stop processing this rule on batch failure to avoid loops
      hasMore = false;
    }

    // If we got fewer than BATCH_SIZE, no more to process
    if (candidates.length < BATCH_SIZE) {
      hasMore = false;
    }
  }

  return totalArchived;
}

/**
 * Returns a WHERE clause fragment that excludes rows referenced by active
 * assignments or ongoing runs, preventing deletion of in-use data.
 */
function getActiveReferenceExclusion(sourceTable: string): string {
  switch (sourceTable) {
    case 'agent_runs':
      return `AND t.id NOT IN (
        SELECT run_id FROM agent_assignments WHERE status IN ('assigned', 'in_progress')
      )`;
    case 'task_run_outcomes':
      return `AND t.id NOT IN (
        SELECT outcome_id FROM agent_assignments WHERE status IN ('assigned', 'in_progress') AND outcome_id IS NOT NULL
      )`;
    default:
      return '';
  }
}

// ─── Batch Archival ─────────────────────────────────────────────

async function archiveBatch(rule: RetentionRule, ids: string[]): Promise<number> {
  let archived = 0;
  const expiresAt = new Date(
    Date.now() + rule.archive_retention_days * 24 * 60 * 60 * 1000,
  ).toISOString();

  for (const id of ids) {
    try {
      // 1. Snapshot full row as JSONB
      const rows = await systemQuery<Record<string, unknown>>(
        `SELECT * FROM ${rule.source_table} WHERE id = $1`,
        [id],
      );
      if (rows.length === 0) continue;
      const row = rows[0];

      // Determine agent_role from the row (varies by table)
      const agentRole = (row.agent_role ?? row.author_agent ?? row.role ?? null) as string | null;

      // 2. Insert into memory_archive
      await systemQuery(
        `INSERT INTO memory_archive (source_table, source_id, content, agent_role, archived_at, expires_at)
         VALUES ($1, $2, $3, $4, NOW(), $5)
         ON CONFLICT DO NOTHING`,
        [rule.source_table, id, JSON.stringify(row), agentRole, expiresAt],
      );

      // 3. Update memory_lifecycle
      await systemQuery(
        `INSERT INTO memory_lifecycle (source_table, source_id, current_layer, archived_at, archive_reason)
         VALUES ($1, $2, 'archived', NOW(), 'ttl_expired')
         ON CONFLICT (source_table, source_id) DO UPDATE SET
           current_layer = 'archived',
           archived_at = NOW(),
           archive_reason = 'ttl_expired'`,
        [rule.source_table, id],
      );

      // 4. Delete the original row
      await systemQuery(
        `DELETE FROM ${rule.source_table} WHERE id = $1`,
        [id],
      );

      archived++;
    } catch (err) {
      console.warn(
        `[MemoryArchiver] Failed to archive ${rule.source_table}/${id}:`,
        (err as Error).message,
      );
    }
  }

  return archived;
}

// ─── Phase 2: Purge Expired Archives ────────────────────────────

async function purgeExpiredArchives(): Promise<number> {
  const result = await systemQuery<{ count: number }>(
    `WITH deleted AS (
       DELETE FROM memory_archive
       WHERE expires_at IS NOT NULL AND expires_at < NOW()
       RETURNING id
     )
     SELECT COUNT(*)::int AS count FROM deleted`,
    [],
  );
  const count = result[0]?.count ?? 0;
  if (count > 0) {
    console.log(`[MemoryArchiver] Purged ${count} expired archive entries`);
  }
  return count;
}
