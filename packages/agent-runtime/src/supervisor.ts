/**
 * Agent Supervisor — Lifecycle supervision
 *
 * Ported from Fuse V7 runtime/supervisor.ts.
 * Owns AbortController wired into every async operation.
 * Supervision: maxTurns, maxStallTurns, timeoutMs, external abort.
 */

import type { SupervisorConfig, ToolResult, AgentEvent } from './types.js';

export class AgentSupervisor {
  readonly config: SupervisorConfig;

  private controller = new AbortController();
  private startTime = Date.now();

  private turnCount = 0;
  private stallCount = 0;
  private filesWritten = 0;
  private memoryKeysWritten = 0;
  private lastFileCount = 0;
  private lastMemoryKeyCount = 0;
  private turnHadProgress = false;

  constructor(config: SupervisorConfig) {
    this.config = config;
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  get isAborted(): boolean {
    return this.controller.signal.aborted;
  }

  get elapsedMs(): number {
    return Date.now() - this.startTime;
  }

  get stats() {
    return {
      turnCount: this.turnCount,
      stallCount: this.stallCount,
      filesWritten: this.filesWritten,
      memoryKeysWritten: this.memoryKeysWritten,
      elapsedMs: this.elapsedMs,
      isAborted: this.isAborted,
    };
  }

  checkBeforeModelCall(): { ok: boolean; reason?: string } {
    // Evaluate stall status for the previous turn (turns > 1).
    // A turn with no progress across ALL its tool results counts as one stall.
    if (this.turnCount > 0 && !this.turnHadProgress) {
      this.stallCount++;
    } else if (this.turnCount > 0) {
      this.stallCount = 0;
    }
    this.turnHadProgress = false;

    this.turnCount++;

    if (this.isAborted) {
      const reason = (this.controller.signal.reason as Error)?.message || 'aborted';
      return { ok: false, reason };
    }

    if (this.turnCount > this.config.maxTurns) {
      this.abort(`Exceeded max turns (${this.config.maxTurns})`);
      return { ok: false, reason: 'max_turns_exceeded' };
    }

    if (this.elapsedMs > this.config.timeoutMs) {
      this.abort(`Exceeded timeout (${this.config.timeoutMs}ms)`);
      return { ok: false, reason: 'timeout' };
    }

    if (this.stallCount >= this.config.maxStallTurns) {
      this.abort(`Stalled: ${this.config.maxStallTurns} consecutive turns without progress`);
      return { ok: false, reason: 'stalled' };
    }

    return { ok: true };
  }

  recordToolResult(_toolName: string, result: ToolResult): { ok: boolean; reason?: string } {
    this.filesWritten += result.filesWritten ?? 0;
    this.memoryKeysWritten += result.memoryKeysWritten ?? 0;

    const wroteData =
      this.filesWritten > this.lastFileCount ||
      this.memoryKeysWritten > this.lastMemoryKeyCount;

    // In readsAsProgress mode (on_demand chat), any successful tool result
    // counts as progress — the agent is gathering info to answer a question.
    const madeProgress = wroteData ||
      (this.config.readsAsProgress === true && result.success);

    if (madeProgress) {
      this.turnHadProgress = true;
      this.lastFileCount = this.filesWritten;
      this.lastMemoryKeyCount = this.memoryKeysWritten;
    }

    return { ok: true };
  }

  abort(reason: string): void {
    if (!this.isAborted) {
      this.controller.abort(new Error(reason));
      if (this.config.onEvent) {
        this.config.onEvent({
          type: 'agent_aborted',
          agentId: 'unknown',
          reason,
          totalTurns: this.turnCount,
          elapsedMs: this.elapsedMs,
        } as AgentEvent);
      }
    }
  }
}
