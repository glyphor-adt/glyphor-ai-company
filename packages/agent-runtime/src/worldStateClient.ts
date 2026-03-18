/**
 * World State Client — Persistent cross-agent knowledge store.
 *
 * Agents read at task start (readWorldState) and write on task completion
 * (writeWorldState). This replaces hub-and-spoke context routing via CoS.
 */

import { systemQuery } from '@glyphor/shared/db';

// ─── TTL Defaults (hours) per domain ─────────────────────────────

const DOMAIN_TTL_HOURS: Record<string, number> = {
  customer: 24,
  campaign: 6,
  strategy: 168,    // 7 days
  agent_output: 48,
  market: 12,
};

// ─── Types ───────────────────────────────────────────────────────

export interface WorldStateEntry {
  value: unknown;
  confidence: number;
  age_minutes: number;
  stale: boolean;
}

export interface WorldStateHealthSummary {
  total: number;
  by_domain: Record<string, { keys: number; last_write: string }>;
  stale_count: number;
  expired_count: number;
}

interface WorldStateRow {
  key: string;
  value: unknown;
  confidence: number;
  updated_at: string;
  valid_until: string | null;
}

interface StaleRow {
  domain: string;
  key: string;
  written_by_agent: string;
  updated_at: string;
  valid_until: string | null;
  age_hours: number;
  freshness: 'fresh' | 'stale' | 'expired';
}

// ─── Read ────────────────────────────────────────────────────────

export async function readWorldState(
  domain: string,
  entityId: string | null,
  keys: string[],
): Promise<Record<string, WorldStateEntry>> {
  if (keys.length === 0) return {};

  const rows = await systemQuery<WorldStateRow>(
    `SELECT key, value, confidence, updated_at, valid_until
     FROM world_state
     WHERE domain = $1
       AND (entity_id = $2 OR (entity_id IS NULL AND $2 IS NULL))
       AND key = ANY($3)
       AND (valid_until IS NULL OR valid_until > NOW())`,
    [domain, entityId, keys],
  );

  return rows.reduce<Record<string, WorldStateEntry>>((acc, row) => {
    const updatedAt = new Date(row.updated_at);
    acc[row.key] = {
      value: row.value,
      confidence: Number(row.confidence),
      age_minutes: Math.round((Date.now() - updatedAt.getTime()) / 60000),
      stale: row.valid_until != null && new Date(row.valid_until) < new Date(),
    };
    return acc;
  }, {});
}

// ─── Write (upsert) ─────────────────────────────────────────────

export async function writeWorldState(
  domain: string,
  entityId: string | null,
  key: string,
  value: unknown,
  writtenByAgent: string,
  options?: { confidence?: number; validUntilHours?: number },
): Promise<void> {
  const ttlHours = options?.validUntilHours ?? DOMAIN_TTL_HOURS[domain];
  const validUntil = ttlHours
    ? new Date(Date.now() + ttlHours * 3600000).toISOString()
    : null;

  await systemQuery(
    `INSERT INTO world_state (domain, entity_id, key, value, written_by_agent, confidence, valid_until)
     VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz)
     ON CONFLICT (tenant_id, domain, COALESCE(entity_id, '__global__'), key) DO UPDATE
       SET value = EXCLUDED.value,
           written_by_agent = EXCLUDED.written_by_agent,
           confidence = EXCLUDED.confidence,
           valid_until = EXCLUDED.valid_until,
           updated_at = NOW()`,
    [domain, entityId, key, JSON.stringify(value), writtenByAgent,
     options?.confidence ?? 1.0, validUntil],
  );
}

// ─── Format for System Prompt Injection ─────────────────────────

export function formatWorldStateForPrompt(
  worldContext: Record<string, WorldStateEntry>,
): string {
  const entries = Object.entries(worldContext);
  if (entries.length === 0) return '';

  const lines = ['## Current World State (Shared Context)', ''];
  for (const [key, entry] of entries) {
    const staleTag = entry.stale ? ` [STALE - ${Math.round(entry.age_minutes / 60)}h old]` : '';
    const confidenceTag = entry.confidence < 0.7 ? ` (low confidence: ${entry.confidence.toFixed(2)})` : '';
    const valueStr = typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value, null, 2);
    lines.push(`### ${key}${staleTag}${confidenceTag}`);
    lines.push(valueStr);
    lines.push(`_Updated ${entry.age_minutes} minutes ago_`);
    lines.push('');
  }
  return lines.join('\n');
}

// ─── Stale State Detection ──────────────────────────────────────

export async function getStaleEntries(): Promise<StaleRow[]> {
  return systemQuery<StaleRow>(
    `SELECT
       domain,
       key,
       written_by_agent,
       updated_at,
       valid_until,
       EXTRACT(EPOCH FROM (NOW() - updated_at)) / 3600 AS age_hours,
       CASE
         WHEN valid_until < NOW() THEN 'expired'
         WHEN updated_at < NOW() - INTERVAL '24 hours' AND domain = 'customer' THEN 'stale'
         WHEN updated_at < NOW() - INTERVAL '6 hours' AND domain = 'campaign' THEN 'stale'
         WHEN updated_at < NOW() - INTERVAL '7 days' AND domain = 'strategy' THEN 'stale'
         WHEN updated_at < NOW() - INTERVAL '48 hours' AND domain = 'agent_output' THEN 'stale'
         WHEN updated_at < NOW() - INTERVAL '12 hours' AND domain = 'market' THEN 'stale'
         ELSE 'fresh'
       END AS freshness
     FROM world_state
     ORDER BY age_hours DESC`,
  );
}

export async function getWorldStateHealth(): Promise<WorldStateHealthSummary> {
  const [totalRow] = await systemQuery<{ count: string }>(
    `SELECT COUNT(*) AS count FROM world_state`,
  );

  const domainRows = await systemQuery<{ domain: string; keys: string; last_write: string }>(
    `SELECT domain, COUNT(*) AS keys, MAX(updated_at) AS last_write
     FROM world_state GROUP BY domain`,
  );

  const [staleRow] = await systemQuery<{ count: string }>(
    `SELECT COUNT(*) AS count FROM world_state
     WHERE valid_until IS NOT NULL AND valid_until < NOW()
       AND updated_at > NOW() - INTERVAL '1 hour'`,
  );

  const [expiredRow] = await systemQuery<{ count: string }>(
    `SELECT COUNT(*) AS count FROM world_state
     WHERE valid_until IS NOT NULL AND valid_until < NOW()`,
  );

  const by_domain: Record<string, { keys: number; last_write: string }> = {};
  for (const row of domainRows) {
    by_domain[row.domain] = { keys: Number(row.keys), last_write: row.last_write };
  }

  return {
    total: Number(totalRow?.count ?? 0),
    by_domain,
    stale_count: Number(staleRow?.count ?? 0),
    expired_count: Number(expiredRow?.count ?? 0),
  };
}
