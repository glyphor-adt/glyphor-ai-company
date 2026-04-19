import type { ToolResult } from './types.js';

/**
 * Per-run cache for read-only tools.
 *
 * Motivation: Chief-of-Staff's work_loop re-calls tools like
 * `read_founder_directives` 11× with the same args (documented in
 * `/memories/session/cos-context-monday-plan.md`). The transcript-level
 * dedup in `context/toolResultDedup.ts` shrinks the echo, but the model
 * still burns tokens/latency re-running the query every turn AND the
 * freshest copy is still a 19KB blob.
 *
 * This cache sits at the tool-runtime layer: on a cache hit we short-circuit
 * `tool.execute()` entirely and return a compact stub that tells the model
 * "you already ran this; see turn N". That makes even the first transcript
 * appearance of the repeat call small.
 *
 * Scope: per-run (runId). Keyed on `(toolName, stableStringify(params))`.
 * Never caches:
 *   - tools in `NEVER_CACHE_TOOLS` (mutating, time-sensitive, user-facing)
 *   - failed results (`result.success === false`)
 * Only caches tools in `READ_ONLY_CACHEABLE_TOOLS`.
 *
 * Feature flag: `ENABLE_TOOL_RESULT_CACHE` env var. Off = full passthrough.
 */

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/**
 * Read-only, idempotent tools safe to cache within a single run.
 * Add conservatively — the cost of a false-cache (stale data) is worse
 * than the cost of a repeat query. Derived from the CoS workload profile.
 */
export const READ_ONLY_CACHEABLE_TOOLS: ReadonlySet<string> = new Set([
  'read_founder_directives',
  'get_agent_directory',
  'who_handles',
  'check_messages',
  'list_assignments',
  'read_bulletins',
  'get_company_context',
  'get_department_summary',
  'read_decision_log',
  'read_role_briefs',
]);

/**
 * Tools we must NEVER cache — even if a caller mistakenly adds them to
 * the cacheable set. This is a belt-and-suspenders safeguard.
 */
const NEVER_CACHE_TOOLS: ReadonlySet<string> = new Set([
  'create_work_assignments',
  'create_team_assignments',
  'create_sub_team_assignment',
  'dispatch_assignment',
  'send_agent_message',
  'send_briefing',
  'create_decision',
  'submit_assignment_output',
  'flag_assignment_blocker',
  'request_tool_access',
  'update_cloud_run_secrets',
  'check_assignment_status', // status can change turn-over-turn
  'run_subagent',
]);

export function isCacheableReadOnlyTool(toolName: string): boolean {
  if (NEVER_CACHE_TOOLS.has(toolName)) return false;
  return READ_ONLY_CACHEABLE_TOOLS.has(toolName);
}

export function isCacheEnabled(): boolean {
  return process.env.ENABLE_TOOL_RESULT_CACHE === '1'
    || process.env.ENABLE_TOOL_RESULT_CACHE === 'true';
}

interface CacheEntry {
  result: ToolResult;
  firstSeenTurn: number;
  firstSeenAt: number;
  hits: number;
  /** Compact summary of the original data, computed once at insert. */
  summary: CompactSummary;
}

interface CompactSummary {
  count: number | null;
  ids: string[] | null;
  /** Byte size of the original serialized data. */
  originalBytes: number;
}

const MAX_ENTRIES_PER_RUN = 64;
const ENTRY_TTL_MS = 30 * 60 * 1000; // 30 min per entry

// runId -> (cacheKey -> CacheEntry)
const runCaches = new Map<string, Map<string, CacheEntry>>();
// runId -> last-touched timestamp (for GC)
const runTouched = new Map<string, number>();
const RUN_GC_TTL_MS = 60 * 60 * 1000; // 1 hour since last touch

function cacheKey(toolName: string, params: Record<string, unknown>): string {
  return `${toolName}::${stableStringify(params ?? {})}`;
}

function touchRun(runId: string): void {
  runTouched.set(runId, Date.now());
  maybeGcRuns();
}

function maybeGcRuns(): void {
  if (runCaches.size < 32) return; // cheap guard
  const now = Date.now();
  for (const [runId, ts] of runTouched.entries()) {
    if (now - ts > RUN_GC_TTL_MS) {
      runCaches.delete(runId);
      runTouched.delete(runId);
    }
  }
}

function extractIdsAndCount(data: unknown): { count: number | null; ids: string[] | null } {
  if (Array.isArray(data)) {
    const ids = data
      .map((item) => {
        if (item && typeof item === 'object') {
          const obj = item as Record<string, unknown>;
          const id = obj.id ?? obj.assignment_id ?? obj.directive_id ?? obj.agent_id;
          return typeof id === 'string' ? id : null;
        }
        return null;
      })
      .filter((x): x is string => !!x)
      .slice(0, 5);
    return { count: data.length, ids: ids.length ? ids : null };
  }
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    for (const key of ['directives', 'assignments', 'agents', 'messages', 'items', 'results']) {
      const arr = obj[key];
      if (Array.isArray(arr)) {
        const inner = extractIdsAndCount(arr);
        if (inner.count !== null) return inner;
      }
    }
  }
  return { count: null, ids: null };
}

function summarize(result: ToolResult): CompactSummary {
  const original = JSON.stringify(result.data ?? null);
  const { count, ids } = extractIdsAndCount(result.data);
  return { count, ids, originalBytes: original.length };
}

/**
 * Look up a cached result for this run. Returns null on miss or when the
 * feature flag is off, or the tool isn't cacheable.
 */
export function lookupCachedResult(
  runId: string | undefined,
  toolName: string,
  params: Record<string, unknown>,
  currentTurn: number,
): { stubResult: ToolResult; firstSeenTurn: number; hits: number } | null {
  if (!isCacheEnabled()) return null;
  if (!runId) return null;
  if (!isCacheableReadOnlyTool(toolName)) return null;

  const run = runCaches.get(runId);
  if (!run) return null;
  const entry = run.get(cacheKey(toolName, params));
  if (!entry) return null;
  if (Date.now() - entry.firstSeenAt > ENTRY_TTL_MS) {
    run.delete(cacheKey(toolName, params));
    return null;
  }

  entry.hits += 1;
  touchRun(runId);

  const stubData: Record<string, unknown> = {
    cached: true,
    cache_source: 'per_run_tool_cache',
    tool_name: toolName,
    same_as_turn: entry.firstSeenTurn,
    current_turn: currentTurn,
    original_bytes: entry.summary.originalBytes,
    hint: `You already ran ${toolName} with these exact args at turn ${entry.firstSeenTurn}. The result has not changed within this run. Refer to that earlier turn or narrow your arguments if you need different data.`,
  };
  if (entry.summary.count !== null) stubData.count = entry.summary.count;
  if (entry.summary.ids) stubData.sample_ids = entry.summary.ids;

  const stubResult: ToolResult = {
    success: true,
    data: stubData,
    filesWritten: 0,
    memoryKeysWritten: 0,
  };

  return { stubResult, firstSeenTurn: entry.firstSeenTurn, hits: entry.hits };
}

/**
 * Store a successful read-only tool result in this run's cache. No-op for
 * failures, non-cacheable tools, or when the flag is off.
 */
export function rememberToolResult(
  runId: string | undefined,
  toolName: string,
  params: Record<string, unknown>,
  result: ToolResult,
  turnNumber: number,
): void {
  if (!isCacheEnabled()) return;
  if (!runId) return;
  if (!isCacheableReadOnlyTool(toolName)) return;
  if (!result.success) return;

  let run = runCaches.get(runId);
  if (!run) {
    run = new Map();
    runCaches.set(runId, run);
  }
  if (run.size >= MAX_ENTRIES_PER_RUN) {
    // Drop oldest (first-inserted) entry — Map preserves insertion order.
    const firstKey = run.keys().next().value;
    if (firstKey) run.delete(firstKey);
  }

  run.set(cacheKey(toolName, params), {
    result,
    firstSeenTurn: turnNumber,
    firstSeenAt: Date.now(),
    hits: 0,
    summary: summarize(result),
  });
  touchRun(runId);
}

/**
 * Drop this run's cache entries (call on run completion if you want to
 * reclaim memory eagerly; otherwise GC handles it).
 */
export function clearRunCache(runId: string): void {
  runCaches.delete(runId);
  runTouched.delete(runId);
}

/** Stats for logging/telemetry. */
export function getRunCacheStats(runId: string): { entries: number; totalHits: number } {
  const run = runCaches.get(runId);
  if (!run) return { entries: 0, totalHits: 0 };
  let totalHits = 0;
  for (const entry of run.values()) totalHits += entry.hits;
  return { entries: run.size, totalHits };
}
