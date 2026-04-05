/**
 * Concurrent Tool Executor — Parallel Tool Dispatch with Order-Preserving Results
 *
 * Wraps the existing ToolExecutor to add smart concurrency control
 * when the model returns multiple tool calls in a single response.
 *
 * Concurrency model (inspired by Claude Code's StreamingToolExecutor):
 *
 *   1. Classify each tool call as safe or unsafe for parallel execution
 *   2. Safe tools run in parallel when ALL executing tools are also safe
 *   3. Unsafe tools create exclusive barriers (nothing else runs alongside)
 *   4. Results buffer and yield in receipt order (call order, not completion order)
 *   5. If any tool triggers a denial escalation, subsequent tools are aborted
 *
 * This module does NOT replace ToolExecutor — it delegates to
 * `toolExecutor.execute()` for every call, preserving all 20+ enforcement
 * layers (circuit breaker, ABAC, hooks, constitutional checks, etc.).
 *
 * Usage:
 *
 *   const concurrent = new ConcurrentToolExecutor(toolExecutor);
 *   for await (const { call, result } of concurrent.executeBatch(toolCalls, ctx)) {
 *     history.push({ role: 'tool_result', ... });
 *   }
 */

import type { ToolContext, ToolResult, ToolDefinition } from './types.js';
import type { ToolExecutor } from './toolExecutor.js';
import { getToolMeta, isSafeTool } from './buildTool.js';

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export interface ToolCallEntry {
  /** Position index (receipt order). */
  index: number;
  name: string;
  args: Record<string, unknown>;
}

export type TrackedToolStatus = 'queued' | 'executing' | 'completed' | 'yielded';

interface TrackedToolCall {
  entry: ToolCallEntry;
  status: TrackedToolStatus;
  isConcurrencySafe: boolean;
  result: ToolResult | null;
  promise: Promise<void> | null;
}

export interface ConcurrentToolResult {
  /** The original call entry (name, args, index). */
  call: ToolCallEntry;
  /** The tool execution result. */
  result: ToolResult;
}

export interface ConcurrentBatchStats {
  total: number;
  parallelized: number;
  sequential: number;
  aborted: number;
  wallClockMs: number;
}

// ═══════════════════════════════════════════════════════════════════
// TOOL CONCURRENCY CLASSIFICATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Read-only tool name prefixes that are always safe to run concurrently.
 * These tools perform no side effects and can't interfere with each other.
 */
const ALWAYS_SAFE_PREFIXES = [
  'get_', 'read_', 'calculate_', 'recall_', 'query_', 'search_',
  'check_', 'fetch_', 'discover_', 'monitor_', 'list_', 'inspect_',
  'validate_', 'lookup_', 'count_', 'measure_',
];

/**
 * Determine if a tool call is safe to execute concurrently.
 *
 * Priority:
 *   1. `__meta.isConcurrencySafe` from buildTool (explicit)
 *   2. `__meta.isReadOnly` from buildTool (implies safe)
 *   3. Name-prefix heuristic (read-only prefixes)
 *   4. Default: false (fail-closed)
 */
export function classifyToolConcurrency(
  toolName: string,
  tools: Map<string, ToolDefinition>,
): boolean {
  const tool = tools.get(toolName);
  if (tool) {
    const meta = getToolMeta(tool);
    if (meta.isConcurrencySafe) return true;
    if (meta.isReadOnly) return true;
  }

  // Name-prefix heuristic for dynamic/runtime tools not in the static map
  return ALWAYS_SAFE_PREFIXES.some(prefix => toolName.startsWith(prefix));
}

// ═══════════════════════════════════════════════════════════════════
// CONCURRENT TOOL EXECUTOR
// ═══════════════════════════════════════════════════════════════════

export class ConcurrentToolExecutor {
  private toolExecutor: ToolExecutor;
  private aborted = false;
  private abortReason: string | null = null;

  constructor(toolExecutor: ToolExecutor) {
    this.toolExecutor = toolExecutor;
  }

  /**
   * Execute a batch of tool calls with smart concurrency control.
   *
   * Yields `{ call, result }` pairs in receipt order (the order calls
   * were passed in), regardless of which tools finish first.
   *
   * For single-tool batches, this behaves identically to sequential execution.
   */
  async *executeBatch(
    toolCalls: ToolCallEntry[],
    context: ToolContext,
  ): AsyncGenerator<ConcurrentToolResult, ConcurrentBatchStats> {
    const startMs = Date.now();
    const tools = this.getToolMap();

    // Track all tool calls
    const tracked: TrackedToolCall[] = toolCalls.map(entry => ({
      entry,
      status: 'queued' as TrackedToolStatus,
      isConcurrencySafe: classifyToolConcurrency(entry.name, tools),
      result: null,
      promise: null,
    }));

    let parallelized = 0;
    let sequential = 0;
    let abortedCount = 0;

    // Process until all tools are yielded or aborted
    while (tracked.some(t => t.status !== 'yielded')) {
      if (context.abortSignal?.aborted || this.aborted) {
        // Abort all remaining queued tools
        for (const t of tracked) {
          if (t.status === 'queued') {
            t.status = 'completed';
            t.result = {
              success: false,
              error: this.abortReason ?? 'Batch aborted',
              filesWritten: 0,
              memoryKeysWritten: 0,
            };
            abortedCount++;
          }
        }
      }

      // Schedule: start tools that can run now
      this.scheduleTools(tracked, context, tools);

      // Count parallel executions
      const executingCount = tracked.filter(t => t.status === 'executing').length;
      if (executingCount > 1) {
        parallelized += executingCount;
      } else if (executingCount === 1) {
        sequential++;
      }

      // Wait for at least one executing tool to complete
      const executingPromises = tracked
        .filter(t => t.status === 'executing' && t.promise)
        .map(t => t.promise!);

      if (executingPromises.length > 0) {
        await Promise.race(executingPromises);
      }

      // Yield completed results in receipt order
      for (const t of tracked) {
        if (t.status === 'completed' && t.result) {
          t.status = 'yielded';
          yield { call: t.entry, result: t.result };
        } else if (t.status === 'executing' || t.status === 'queued') {
          // Stop yielding at first non-complete entry (preserve order)
          break;
        }
      }
    }

    return {
      total: tracked.length,
      parallelized,
      sequential,
      aborted: abortedCount,
      wallClockMs: Date.now() - startMs,
    };
  }

  // ─── Scheduling ──────────────────────────────────────────────

  private scheduleTools(
    tracked: TrackedToolCall[],
    context: ToolContext,
    tools: Map<string, ToolDefinition>,
  ): void {
    for (const t of tracked) {
      if (t.status !== 'queued') continue;
      if (this.aborted) break;

      if (this.canStartTool(t, tracked)) {
        this.startTool(t, context);
      } else if (!t.isConcurrencySafe) {
        // Non-safe tool blocks: don't look past it
        break;
      }
    }
  }

  /**
   * A tool can start if:
   *   - No tools are currently executing, OR
   *   - This tool is safe AND all executing tools are also safe
   */
  private canStartTool(
    tool: TrackedToolCall,
    tracked: TrackedToolCall[],
  ): boolean {
    const executing = tracked.filter(t => t.status === 'executing');
    if (executing.length === 0) return true;

    return (
      tool.isConcurrencySafe &&
      executing.every(t => t.isConcurrencySafe)
    );
  }

  private startTool(tool: TrackedToolCall, context: ToolContext): void {
    tool.status = 'executing';
    tool.promise = this.runTool(tool, context);
  }

  private async runTool(
    tool: TrackedToolCall,
    context: ToolContext,
  ): Promise<void> {
    try {
      // Delegate to ToolExecutor which has ALL enforcement layers
      const result = await this.toolExecutor.execute(
        tool.entry.name,
        tool.entry.args,
        context,
      );
      tool.result = result;
      tool.status = 'completed';

      // Check for cascading abort conditions
      if (!result.success && this.shouldCascadeAbort(tool.entry.name, result)) {
        this.aborted = true;
        this.abortReason = `Cascading abort after ${tool.entry.name} failure: ${result.error}`;
      }
    } catch (err) {
      tool.result = {
        success: false,
        error: `Execution error: ${(err as Error).message}`,
        filesWritten: 0,
        memoryKeysWritten: 0,
      };
      tool.status = 'completed';
    }
  }

  /**
   * Determine if a tool failure should abort all remaining tools.
   *
   * Cascading abort triggers:
   *   - Circuit breaker trip (global halt)
   *   - Denial escalation (run-level abort)
   *   - Destructive tool failure (dangerous to continue)
   */
  private shouldCascadeAbort(toolName: string, result: ToolResult): boolean {
    // Circuit breaker messages
    if (result.error?.includes('circuit_breaker') || result.error?.includes('fleet halt')) {
      return true;
    }
    // Denial escalation
    if (result.error?.includes('abort_run') || result.error?.includes('denial_escalation')) {
      return true;
    }
    // Destructive tool failure — don't continue if a write/deploy failed
    const meta = this.getToolMeta(toolName);
    if (meta?.isDestructive && !result.success) {
      return true;
    }
    return false;
  }

  private getToolMeta(toolName: string) {
    const tools = this.getToolMap();
    const tool = tools.get(toolName);
    return tool ? getToolMeta(tool) : null;
  }

  private getToolMap(): Map<string, ToolDefinition> {
    // Access the tool executor's internal tool map through its public API
    return (this.toolExecutor as any).tools as Map<string, ToolDefinition>;
  }
}

// ═══════════════════════════════════════════════════════════════════
// FACTORY HELPER
// ═══════════════════════════════════════════════════════════════════

/**
 * Determine whether a batch of tool calls should use concurrent execution.
 *
 * Conditions for concurrent dispatch:
 *   1. More than one tool call in the batch
 *   2. At least one tool is concurrency-safe
 *   3. Not all tools are unsafe (would be serial anyway)
 */
export function shouldUseConcurrentExecution(
  toolCalls: Array<{ name: string }>,
  tools: Map<string, ToolDefinition>,
): boolean {
  if (toolCalls.length <= 1) return false;

  const classifications = toolCalls.map(
    call => classifyToolConcurrency(call.name, tools),
  );

  // At least one safe tool that could run in parallel
  return classifications.some(safe => safe);
}
