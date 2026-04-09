/**
 * Agent Supervisor — Lifecycle supervision
 *
 * Ported from the prior internal runtime supervisor.
 * Owns AbortController wired into every async operation.
 * Supervision: maxTurns, maxStallTurns, timeoutMs, external abort.
 */

import type { SupervisorConfig, ToolResult, AgentEvent } from './types.js';
import { getHaltStatus } from './circuitBreaker.js';

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
    const mt = Math.floor(Number(config.maxTurns));
    const safeMax = Number.isFinite(mt) && mt > 0 ? mt : 1;
    const ms = Math.floor(Number(config.maxStallTurns));
    const safeStall = Number.isFinite(ms) && ms > 0 ? ms : 6;
    const tm = Math.floor(Number(config.timeoutMs));
    const safeTimeout = Number.isFinite(tm) && tm > 0 ? tm : 600_000;
    this.config = {
      ...config,
      maxTurns: safeMax,
      maxStallTurns: safeStall,
      timeoutMs: safeTimeout,
    };
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

  async checkBeforeModelCall(): Promise<{ ok: boolean; reason?: string }> {
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

    // ─── Circuit breaker: Level 3 (EMERGENCY) aborts running agents ───
    try {
      const haltStatus = await getHaltStatus();
      if (haltStatus.halted && haltStatus.level === 3) {
        this.abort(`[CIRCUIT BREAKER] EMERGENCY halt: ${haltStatus.reason ?? 'unknown'}`);
        return { ok: false, reason: 'circuit_breaker_emergency' };
      }
    } catch {
      // Fail-open: DB errors should not stop a running agent
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

    // In readsAsProgress mode, any successful tool result
    // counts as progress — the agent is gathering info, not stalling.
    // Without it, only write operations (filesWritten, memoryKeysWritten) count.
    const madeProgress = wroteData ||
      (this.config.readsAsProgress !== false && result.success);

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
