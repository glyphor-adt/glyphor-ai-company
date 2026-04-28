/**
 * Auto-dream v1 — cron-only memory consolidation gates + lease
 *
 * Mirrors Claude auto-dream time + volume gates. Invocation is scheduled,
 * not per-turn.
 */

import type { AgentExecutionResult } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';

const DEFAULT_MIN_HOURS = 24;
const DEFAULT_MIN_RUNS = 5;
const LEASE_MINUTES = 25;

export type MemoryConsolidationGateOk = {
  ok: true;
  lastConsolidatedAt: Date;
  completedRunCount: number;
  minHours: number;
};

export type MemoryConsolidationGateNo = {
  ok: false;
  reason: string;
};

export type MemoryConsolidationGate = MemoryConsolidationGateOk | MemoryConsolidationGateNo;

function readMinHours(): number {
  const n = parseInt(process.env.AUTO_MEMORY_CONSOLIDATION_MIN_HOURS || String(DEFAULT_MIN_HOURS), 10);
  return Number.isFinite(n) && n >= 1 ? n : DEFAULT_MIN_HOURS;
}

function readMinRuns(): number {
  const n = parseInt(process.env.AUTO_MEMORY_CONSOLIDATION_MIN_RUNS || String(DEFAULT_MIN_RUNS), 10);
  return Number.isFinite(n) && n >= 1 ? n : DEFAULT_MIN_RUNS;
}

export function isMemoryConsolidationEnabled(): boolean {
  return process.env.AUTO_MEMORY_CONSOLIDATION_ENABLED !== 'false';
}

/**
 * Evaluate time + volume gates (no lease).
 */
export async function evaluateMemoryConsolidationGates(): Promise<MemoryConsolidationGate> {
  if (!isMemoryConsolidationEnabled()) {
    return { ok: false, reason: 'disabled_by_env' };
  }

  const minHours = readMinHours();
  const minRuns = readMinRuns();

  const [row] = await systemQuery<{ last_consolidated_at: string | Date }>(
    `SELECT last_consolidated_at FROM memory_consolidation_state WHERE id = 'default'`,
  ).catch(() => []);

  const lastRaw = row?.last_consolidated_at;
  const last = lastRaw ? new Date(lastRaw) : new Date(0);
  const hoursSince = (Date.now() - last.getTime()) / 3_600_000;
  if (hoursSince < minHours) {
    return { ok: false, reason: `time_gate:${hoursSince.toFixed(1)}h_lt_${minHours}h` };
  }

  const [countRow] = await systemQuery<{ c: string }>(
    `SELECT COUNT(*)::text AS c
       FROM agent_runs
      WHERE status = 'completed'
        AND completed_at IS NOT NULL
        AND completed_at > $1::timestamptz
        AND COALESCE(task, '') <> 'memory_consolidation'`,
    [last.toISOString()],
  ).catch(() => []);

  const completedRunCount = parseInt(countRow?.c ?? '0', 10);
  if (completedRunCount < minRuns) {
    return { ok: false, reason: `run_count:${completedRunCount}_lt_${minRuns}` };
  }

  return { ok: true, lastConsolidatedAt: last, completedRunCount, minHours };
}

/**
 * Single-flight lease across scheduler replicas.
 */
export async function tryAcquireMemoryConsolidationLease(holder: string): Promise<boolean> {
  const [u] = await systemQuery<{ id: string }>(
    `UPDATE memory_consolidation_state
        SET lease_holder = $1,
            lease_expires_at = NOW() + ($2::int * INTERVAL '1 minute'),
            last_attempt_at = NOW(),
            updated_at = NOW()
      WHERE id = 'default'
        AND (lease_expires_at IS NULL OR lease_expires_at < NOW())
      RETURNING id`,
    [holder, LEASE_MINUTES],
  ).catch(() => []);
  return Boolean(u?.id);
}

export async function releaseMemoryConsolidationLease(): Promise<void> {
  await systemQuery(
    `UPDATE memory_consolidation_state
        SET lease_holder = NULL,
            lease_expires_at = NULL,
            updated_at = NOW()
      WHERE id = 'default'`,
  ).catch(() => {});
}

export async function markMemoryConsolidationSuccess(): Promise<void> {
  await systemQuery(
    `UPDATE memory_consolidation_state
        SET last_consolidated_at = NOW(),
            lease_holder = NULL,
            lease_expires_at = NULL,
            updated_at = NOW()
      WHERE id = 'default'`,
  ).catch(() => {});
}

export function buildMemoryConsolidationPromptMessage(stats: {
  completedRunCount: number;
  lastConsolidatedAt: Date;
  minHours: number;
}, override?: string): string {
  if (override && override.trim().length > 0) return override.trim();

  const lastIso = stats.lastConsolidatedAt.toISOString();
  return [
    '# Memory consolidation (auto-dream v1)',
    '',
    `Since last consolidation (${lastIso}), there have been **${stats.completedRunCount}** completed agent runs (excluding consolidation itself). Minimum interval satisfied (${stats.minHours}h gate).`,
    '',
    'Scope: you work in **agent_memory** only (recall / save). Do not treat this as editing **company_knowledge_base** sections or official doctrine.',
    '',
    '## Promotion policy',
    '',
    '**Save or merge** only when all of the following hold:',
    '- Grounded in real prior runs, tools, docs, metrics, or explicit human decisions — not guesses.',
    '- Reusable across future tasks or agents (not one-off ticket state unless it encodes a standing process).',
    '- Stable wording: prefer "how to obtain X" over volatile daily numbers.',
    '- Safe: no secrets, tokens, or unnecessary PII; redact or omit sensitive detail.',
    '',
    '**Do not save**: ephemeral task status, unresolved contradictions (do not pick a fact without evidence), hypothetical incidents/metrics, or noise that duplicates **company_knowledge** rows. Prefer superseding or dropping stale ops facts instead of adding more copies.',
    '',
    '**Shape each saved memory**: one clear claim or short numbered procedure; note scope (roles/area) if needed; optional one-line lineage ("merged N similar on …") without PII. Tag when the tool allows (e.g. ops, deploy, tooling, authority).',
    '',
    '## Your job',
    '1. Use **recall_memories** with a broad or empty filter to see what is already stored across agents.',
    '2. Identify duplicates, stale lines, or themes that should be merged — especially fleet-wide operational facts vs per-agent noise.',
    '3. Use **save_memory** only where it improves durability: merged summaries, corrected facts, or new cross-cutting lessons. Prefer fewer consolidated memories over dozens of tiny duplicates.',
    '4. Do **not** invent incidents or P0 narratives; consolidation is about organizing real prior signal, not hypothesizing.',
    '5. Keep total **save_memory** calls reasonable (on the order of 10–30), favoring quality over quantity.',
    '',
    'End with a short bullet summary of what you merged, dropped, or chose not to change.',
  ].join('\n');
}

export function memoryConsolidationSkipResult(reason: string): AgentExecutionResult {
  return {
    agentId: 'memory-consolidation-precheck',
    role: 'ops',
    status: 'skipped_precheck',
    output: `Memory consolidation skipped: ${reason}`,
    resultSummary: `Precheck skip: ${reason}`,
    totalTurns: 0,
    totalFilesWritten: 0,
    totalMemoryKeysWritten: 0,
    elapsedMs: 0,
    inputTokens: 0,
    outputTokens: 0,
    thinkingTokens: 0,
    cachedInputTokens: 0,
    cost: 0,
    estimatedCostUsd: 0,
    conversationHistory: [],
  };
}
