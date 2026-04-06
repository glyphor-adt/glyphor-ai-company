/**
 * Parallel Assignment Dispatcher — Concurrent Work Assignment Execution
 *
 * Inspired by Claude Code's Coordinator Mode, which spawns parallel worker
 * agents for independent sub-problems.
 *
 * When an orchestrator decomposes a directive into multiple work assignments,
 * this module classifies which assignments can run in parallel (no data
 * dependencies) and dispatches them concurrently via Promise.allSettled.
 *
 * Dependent assignments run after their dependencies complete, with results
 * from earlier assignments injected as additional context.
 *
 * Usage:
 *
 *   const results = await dispatchParallelAssignments(assignments, {
 *     executeAssignment: async (assignment, priorResults) => { ... },
 *     onAssignmentComplete: (assignmentId, result) => { ... },
 *   });
 */

import type { CompanyAgentRole } from './types.js';
import { startTraceSpan } from './telemetry/tracing.js';
import { recordRunEvent } from './telemetry/runLedger.js';

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export interface ParallelAssignment {
  /** Work assignment ID. */
  id: string;
  /** Agent role to execute the assignment. */
  assignedTo: CompanyAgentRole;
  /** Human-readable task description. */
  description: string;
  /** IDs of assignments this one depends on (must complete first). */
  dependsOn?: string[];
  /** Priority hint (lower = higher priority). */
  priority?: number;
  /** Arbitrary context to pass through to the executor. */
  context?: Record<string, unknown>;
}

export interface AssignmentResult {
  assignmentId: string;
  assignedTo: CompanyAgentRole;
  status: 'completed' | 'failed';
  output?: string;
  error?: string;
  durationMs: number;
}

export interface ParallelDispatchContext {
  /** Execute a single assignment. Receives prior results for dependency injection. */
  executeAssignment: (
    assignment: ParallelAssignment,
    priorResults: Map<string, AssignmentResult>,
  ) => Promise<AssignmentResult>;
  /** Optional callback fired when each assignment completes. */
  onAssignmentComplete?: (assignmentId: string, result: AssignmentResult) => void;
  /** Run ID for trace linkage. */
  runId?: string;
  /** Abort signal for early termination. */
  abortSignal?: AbortSignal;
  /** Max concurrent assignments (default: 4). */
  maxConcurrent?: number;
}

export interface ParallelDispatchResult {
  results: AssignmentResult[];
  parallelBatches: number;
  totalDurationMs: number;
  /** IDs of assignments that ran concurrently. */
  parallelizedIds: string[];
  /** IDs of assignments that waited for dependencies. */
  serializedIds: string[];
}

// ═══════════════════════════════════════════════════════════════════
// DEPENDENCY CLASSIFICATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Classify assignments into independent and dependent groups
 * using topological ordering.
 *
 * Assignments with no `dependsOn` (or empty array) are independent.
 * Dependent assignments are ordered so that each assignment's
 * dependencies appear earlier in the output.
 *
 * Throws on circular dependencies.
 */
export function classifyDependencies(assignments: ParallelAssignment[]): {
  /** Assignments with no dependencies — can run in parallel. */
  independent: ParallelAssignment[];
  /** Assignments with dependencies — ordered topologically. */
  dependent: ParallelAssignment[];
} {
  const byId = new Map(assignments.map(a => [a.id, a]));
  const independent: ParallelAssignment[] = [];
  const dependent: ParallelAssignment[] = [];

  // Topological sort for dependent assignments
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const sorted: ParallelAssignment[] = [];

  function visit(id: string): void {
    if (visited.has(id)) return;
    if (inStack.has(id)) {
      throw new Error(
        `[ParallelDispatch] Circular dependency detected involving assignment "${id}"`,
      );
    }

    const assignment = byId.get(id);
    if (!assignment) return;

    inStack.add(id);
    for (const depId of assignment.dependsOn ?? []) {
      visit(depId);
    }
    inStack.delete(id);
    visited.add(id);
    sorted.push(assignment);
  }

  for (const a of assignments) {
    if (!a.dependsOn || a.dependsOn.length === 0) {
      independent.push(a);
      visited.add(a.id);
    }
  }

  for (const a of assignments) {
    if (a.dependsOn && a.dependsOn.length > 0) {
      visit(a.id);
    }
  }

  // `sorted` includes independent ones from visit() calls; filter to only dependent
  for (const a of sorted) {
    if (a.dependsOn && a.dependsOn.length > 0) {
      dependent.push(a);
    }
  }

  return { independent, dependent };
}

// ═══════════════════════════════════════════════════════════════════
// PARALLEL DISPATCHER
// ═══════════════════════════════════════════════════════════════════

/**
 * Dispatch assignments with dependency-aware parallelism.
 *
 * 1. Independent assignments run concurrently (up to maxConcurrent).
 * 2. Dependent assignments run in topological order, with prior results
 *    made available for context injection.
 * 3. If a dependency failed, the dependent assignment is skipped with
 *    a descriptive error.
 */
export async function dispatchParallelAssignments(
  assignments: ParallelAssignment[],
  ctx: ParallelDispatchContext,
): Promise<ParallelDispatchResult> {
  const startMs = Date.now();
  const maxConcurrent = ctx.maxConcurrent ?? 4;
  const allResults = new Map<string, AssignmentResult>();
  const parallelizedIds: string[] = [];
  const serializedIds: string[] = [];
  let parallelBatches = 0;

  const { independent, dependent } = classifyDependencies(assignments);

  void recordRunEvent({
    runId: ctx.runId,
    eventType: 'orchestration.parallel_dispatch_started',
    trigger: 'parallelAssignmentDispatcher',
    component: 'parallelAssignmentDispatcher',
    payload: {
      total: assignments.length,
      independent: independent.length,
      dependent: dependent.length,
      max_concurrent: maxConcurrent,
    },
  });

  // ── Phase 1: Dispatch independent assignments in parallel batches ──
  if (independent.length > 0) {
    // Sort by priority (lower = higher priority)
    const prioritized = [...independent].sort(
      (a, b) => (a.priority ?? 100) - (b.priority ?? 100),
    );

    for (let i = 0; i < prioritized.length; i += maxConcurrent) {
      if (ctx.abortSignal?.aborted) break;

      const batch = prioritized.slice(i, i + maxConcurrent);
      parallelBatches++;

      const batchSpan = startTraceSpan('parallel_dispatch.batch', {
        run_id: ctx.runId,
        batch_number: parallelBatches,
        batch_size: batch.length,
      });

      const settled = await Promise.allSettled(
        batch.map(async (assignment) => {
          const result = await ctx.executeAssignment(assignment, allResults);
          return { assignmentId: assignment.id, result };
        }),
      );

      for (const outcome of settled) {
        if (outcome.status === 'fulfilled') {
          const { assignmentId, result } = outcome.value;
          allResults.set(assignmentId, result);
          parallelizedIds.push(assignmentId);
          ctx.onAssignmentComplete?.(assignmentId, result);
        } else {
          // Promise rejection — shouldn't happen if executeAssignment catches errors
          const batchEntry = batch[settled.indexOf(outcome)];
          const failResult: AssignmentResult = {
            assignmentId: batchEntry.id,
            assignedTo: batchEntry.assignedTo,
            status: 'failed',
            error: `Dispatch error: ${outcome.reason}`,
            durationMs: 0,
          };
          allResults.set(batchEntry.id, failResult);
          parallelizedIds.push(batchEntry.id);
          ctx.onAssignmentComplete?.(batchEntry.id, failResult);
        }
      }

      batchSpan.end({ completed: settled.length });
    }
  }

  // ── Phase 2: Dispatch dependent assignments sequentially ──
  for (const assignment of dependent) {
    if (ctx.abortSignal?.aborted) break;

    // Check if all dependencies succeeded
    const failedDeps = (assignment.dependsOn ?? []).filter(depId => {
      const depResult = allResults.get(depId);
      return !depResult || depResult.status !== 'completed';
    });

    if (failedDeps.length > 0) {
      const skipResult: AssignmentResult = {
        assignmentId: assignment.id,
        assignedTo: assignment.assignedTo,
        status: 'failed',
        error: `Skipped: dependency assignment(s) failed or missing: ${failedDeps.join(', ')}`,
        durationMs: 0,
      };
      allResults.set(assignment.id, skipResult);
      serializedIds.push(assignment.id);
      ctx.onAssignmentComplete?.(assignment.id, skipResult);
      continue;
    }

    const result = await ctx.executeAssignment(assignment, allResults);
    allResults.set(assignment.id, result);
    serializedIds.push(assignment.id);
    ctx.onAssignmentComplete?.(assignment.id, result);
  }

  void recordRunEvent({
    runId: ctx.runId,
    eventType: 'orchestration.parallel_dispatch_completed',
    trigger: 'parallelAssignmentDispatcher',
    component: 'parallelAssignmentDispatcher',
    payload: {
      total: assignments.length,
      completed: [...allResults.values()].filter(r => r.status === 'completed').length,
      failed: [...allResults.values()].filter(r => r.status === 'failed').length,
      parallel_batches: parallelBatches,
      parallelized: parallelizedIds.length,
      serialized: serializedIds.length,
      total_duration_ms: Date.now() - startMs,
    },
  });

  return {
    results: Array.from(allResults.values()),
    parallelBatches,
    totalDurationMs: Date.now() - startMs,
    parallelizedIds,
    serializedIds,
  };
}
