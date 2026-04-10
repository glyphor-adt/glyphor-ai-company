/**
 * Context manifest — audit trail of what was injected into the agent (not full payloads).
 * Used for compliance review and debugging context scope without dumping raw prompts.
 */

import type { ContextManifestEntry } from './types.js';
import { isLikelyReadOnlyTool } from './toolExecutor.js';

export type { ContextManifestEntry };

export class ContextManifestAccumulator {
  private readonly entries: ContextManifestEntry[] = [];
  private totalChars = 0;
  private readonly maxTotal: number;

  constructor(maxTotalChars?: number) {
    const raw = process.env.AGENT_CONTEXT_MANIFEST_MAX_CHARS?.trim();
    const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
    this.maxTotal = maxTotalChars ?? (Number.isFinite(parsed) ? parsed : 400_000);
  }

  /**
   * Record an injection. Pass `content` to auto-estimate chars, or set `chars_estimate` explicitly.
   */
  push(entry: {
    source: string;
    policy?: string;
    turn?: number;
    content?: string;
    chars_estimate?: number;
    meta?: Record<string, unknown>;
  }): void {
    const chars = entry.chars_estimate ?? entry.content?.length ?? 0;
    const { content: _c, ...rest } = entry;
    if (this.totalChars >= this.maxTotal) {
      this.entries.push({
        source: rest.source,
        policy: rest.policy ?? 'dropped_over_cap',
        chars_estimate: 0,
        turn: rest.turn,
        meta: { ...(rest.meta ?? {}), skipped: true, reason: 'manifest_total_cap' },
      });
      return;
    }
    const room = this.maxTotal - this.totalChars;
    const recorded = Math.min(chars, room);
    this.totalChars += recorded;
    this.entries.push({
      source: rest.source,
      policy: rest.policy ?? 'task_scoped',
      chars_estimate: recorded,
      turn: rest.turn,
      meta: {
        ...(rest.meta ?? {}),
        ...(chars > recorded ? { truncated: true, original_chars: chars } : {}),
      },
    });
  }

  snapshot(): ContextManifestEntry[] {
    return [...this.entries];
  }

  totalEstimatedChars(): number {
    return this.totalChars;
  }
}

export function countMutatingToolsFromNames(toolNames: string[]): number {
  return toolNames.filter((n) => !isLikelyReadOnlyTool(n)).length;
}
