import type { ConversationTurn } from '../types.js';

/**
 * Stable JSON stringifier with sorted keys — so `{a:1,b:2}` and `{b:2,a:1}`
 * hash to the same key. Used to match tool calls with identical arguments
 * regardless of key order in the provider's JSON payload.
 */
function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

function toolKey(toolName: string, toolParams: Record<string, unknown> | undefined): string {
  return `${toolName}::${stableStringify(toolParams ?? {})}`;
}

/** Tools we will never dedupe — mutating / order-sensitive / time-sensitive. */
const NEVER_DEDUPE = new Set<string>([
  'create_work_assignments',
  'dispatch_assignment',
  'send_agent_message',
  'send_briefing',
  'create_decision',
  'submit_assignment_output',
  'flag_assignment_blocker',
  'request_tool_access',
  'update_cloud_run_secrets',
]);

/**
 * Short stub content that replaces an earlier duplicate tool_result.
 * We keep the tool_call → tool_result pairing intact (provider APIs
 * require it) but shrink the content so the transcript echo is small.
 */
function makeStub(toolName: string, laterIndex: number, originalBytes: number): string {
  return `[Result superseded by a later identical call to ${toolName} at turn-index ${laterIndex}. Refer to that result instead. Original was ${originalBytes} bytes.]`;
}

export interface DedupeStats {
  stubbedCount: number;
  originalBytes: number;
  dedupedBytes: number;
  /** Per-tool stub count, for telemetry. */
  perTool: Record<string, number>;
}

export interface DedupeResult {
  history: ConversationTurn[];
  stats: DedupeStats;
}

/**
 * Deduplicate repeated identical tool_result entries in the transcript
 * by replacing earlier duplicates' `content` with a short stub. Preserves
 * tool_call / tool_result pairing (required by Anthropic, OpenAI, Gemini).
 *
 * Keys on (toolName, stableHash(toolParams)). The MOST RECENT call's result
 * is kept full; all earlier identical calls are stubbed.
 *
 * Does not mutate the input array — returns a shallow copy with replaced
 * turns as needed.
 */
export function dedupeToolResults(history: ConversationTurn[]): DedupeResult {
  // Map each tool_result's index to its paired tool_call (nearest preceding
  // tool_call turn with matching toolName). The provider serializers pair
  // them strictly in order, so we mirror that.
  const pairedParams: (Record<string, unknown> | undefined)[] = new Array(history.length);
  const lastSeenCallParams = new Map<string, Record<string, unknown>>();

  for (let i = 0; i < history.length; i++) {
    const t = history[i];
    if (t.role === 'tool_call' && t.toolName) {
      lastSeenCallParams.set(t.toolName, t.toolParams ?? {});
    } else if (t.role === 'tool_result' && t.toolName) {
      pairedParams[i] = lastSeenCallParams.get(t.toolName);
    }
  }

  // First pass: find the LAST occurrence index of each (toolName, params) key
  // among tool_result turns (skipping NEVER_DEDUPE and failed results).
  const lastIdxForKey = new Map<string, number>();
  for (let i = 0; i < history.length; i++) {
    const t = history[i];
    if (t.role !== 'tool_result' || !t.toolName) continue;
    if (NEVER_DEDUPE.has(t.toolName)) continue;
    // Only dedupe successful results — a failed call may have different
    // downstream reasoning even with identical args.
    if (t.toolResult && t.toolResult.success === false) continue;
    const key = toolKey(t.toolName, pairedParams[i]);
    lastIdxForKey.set(key, i);
  }

  // Second pass: replace earlier duplicates with stubs.
  const out = history.slice();
  const stats: DedupeStats = {
    stubbedCount: 0,
    originalBytes: 0,
    dedupedBytes: 0,
    perTool: {},
  };

  for (let i = 0; i < out.length; i++) {
    const t = out[i];
    if (t.role !== 'tool_result' || !t.toolName) continue;
    stats.originalBytes += t.content?.length ?? 0;

    if (NEVER_DEDUPE.has(t.toolName)) {
      stats.dedupedBytes += t.content?.length ?? 0;
      continue;
    }
    if (t.toolResult && t.toolResult.success === false) {
      stats.dedupedBytes += t.content?.length ?? 0;
      continue;
    }
    const key = toolKey(t.toolName, pairedParams[i]);
    const lastIdx = lastIdxForKey.get(key);
    if (lastIdx !== undefined && lastIdx !== i) {
      const originalLen = t.content?.length ?? 0;
      const stub = makeStub(t.toolName, lastIdx, originalLen);
      out[i] = { ...t, content: stub };
      stats.stubbedCount += 1;
      stats.perTool[t.toolName] = (stats.perTool[t.toolName] ?? 0) + 1;
      stats.dedupedBytes += stub.length;
    } else {
      stats.dedupedBytes += t.content?.length ?? 0;
    }
  }

  return { history: out, stats };
}

/**
 * Env-gated wrapper: returns the original history unchanged when the
 * feature flag is off. Accepts the flag value as an argument so callers
 * can log the effective setting per run.
 */
export function maybeDedupeToolResults(
  history: ConversationTurn[],
  enabled: boolean,
): DedupeResult {
  if (!enabled) {
    return {
      history,
      stats: { stubbedCount: 0, originalBytes: 0, dedupedBytes: 0, perTool: {} },
    };
  }
  return dedupeToolResults(history);
}
