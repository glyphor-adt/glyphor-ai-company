/**
 * Parallel Dispatch — Wave-based parallel agent execution
 *
 * Replaces sequential agent waking with dependency-aware parallel waves:
 *   1. SCAN — Check all agents for work (fast DB reads)
 *   2. RESOLVE — Group into waves based on depends_on chains
 *   3. DISPATCH — Fire each wave in parallel via Promise.allSettled()
 *
 * Also provides event-driven dependency resolution: when an assignment
 * completes, immediately dispatch agents whose dependencies are now met.
 */

import { systemQuery } from '@glyphor/shared/db';
import type { CompanyAgentRole, AgentExecutionResult } from '@glyphor/agent-runtime';

/** Maximum agents to dispatch concurrently within a single wave */
const MAX_CONCURRENT_AGENTS = 10;

/** Timeout for each agent dispatch (ms) */
const DISPATCH_TIMEOUT_MS = 120_000;

type AgentExecutorFn = (
  agentRole: CompanyAgentRole,
  task: string,
  payload: Record<string, unknown>,
) => Promise<AgentExecutionResult | void>;

export interface WaveAgent {
  role: CompanyAgentRole;
  task: string;
  context: Record<string, unknown>;
  /** Assignment ID if this agent has pending work from an assignment */
  assignmentId?: string;
  /** Assignment IDs this agent depends on */
  dependsOn?: string[];
}

export interface WaveDispatchResult {
  totalAgents: number;
  waves: number;
  dispatched: string[];
  skipped: string[];
  failed: string[];
}

// ═══════════════════════════════════════════════════════════════════
// WAVE BUILDER — Group agents into dependency-ordered waves
// ═══════════════════════════════════════════════════════════════════

/**
 * Build execution waves from a list of agents with work.
 *
 * Agents with no dependencies (or no depends_on) go into Wave 0.
 * Agents depending on Wave N agents go into Wave N+1.
 * Circular dependencies are broken by placing agents in the latest possible wave.
 */
export function buildWaves(agents: WaveAgent[]): WaveAgent[][] {
  if (agents.length === 0) return [];

  // Map assignment IDs to the agent that owns them
  const assignmentOwner = new Map<string, string>();
  for (const agent of agents) {
    if (agent.assignmentId) {
      assignmentOwner.set(agent.assignmentId, agent.role);
    }
  }

  // Build adjacency: which agents does each agent depend on?
  const agentDeps = new Map<string, Set<string>>();
  for (const agent of agents) {
    const deps = new Set<string>();
    if (agent.dependsOn) {
      for (const depId of agent.dependsOn) {
        const ownerRole = assignmentOwner.get(depId);
        // Only count as dependency if the owner is in THIS dispatch batch
        if (ownerRole && ownerRole !== agent.role) {
          deps.add(ownerRole);
        }
      }
    }
    agentDeps.set(agent.role, deps);
  }

  // Topological sort into waves
  const waves: WaveAgent[][] = [];
  const assigned = new Set<string>();

  while (assigned.size < agents.length) {
    const wave: WaveAgent[] = [];

    for (const agent of agents) {
      if (assigned.has(agent.role)) continue;

      const deps = agentDeps.get(agent.role) ?? new Set();
      const unmetDeps = [...deps].filter(d => !assigned.has(d));

      if (unmetDeps.length === 0) {
        wave.push(agent);
      }
    }

    // If no agents can be added (circular dependency), break the cycle
    // by adding all remaining agents to the current wave
    if (wave.length === 0) {
      for (const agent of agents) {
        if (!assigned.has(agent.role)) {
          wave.push(agent);
        }
      }
    }

    for (const agent of wave) {
      assigned.add(agent.role);
    }
    waves.push(wave);
  }

  return waves;
}

// ═══════════════════════════════════════════════════════════════════
// CONCURRENCY GUARD — Prevent double-dispatch
// ═══════════════════════════════════════════════════════════════════

/**
 * Check if an agent is already running (has an active agent_runs row).
 * Returns true if the agent should be SKIPPED.
 */
async function isAgentRunning(agentRole: string): Promise<boolean> {
  const data = await systemQuery<{ id: string }>(
    'SELECT id FROM agent_runs WHERE agent_id = $1 AND status = $2 LIMIT 1',
    [agentRole, 'running'],
  );
  return data.length > 0;
}

// ═══════════════════════════════════════════════════════════════════
// PARALLEL WAVE DISPATCHER
// ═══════════════════════════════════════════════════════════════════

/**
 * Dispatch agents in dependency-ordered parallel waves.
 *
 * Within each wave, agents run concurrently (up to MAX_CONCURRENT_AGENTS).
 * The next wave starts only after the previous wave completes.
 */
export async function dispatchWaves(
  waves: WaveAgent[][],
  executor: AgentExecutorFn,
): Promise<WaveDispatchResult> {
  const result: WaveDispatchResult = {
    totalAgents: waves.reduce((sum, w) => sum + w.length, 0),
    waves: waves.length,
    dispatched: [],
    skipped: [],
    failed: [],
  };

  for (let waveIdx = 0; waveIdx < waves.length; waveIdx++) {
    const wave = waves[waveIdx];
    const waveRoles = wave.map(a => a.role);
    console.log(
      `[ParallelDispatch] Wave ${waveIdx + 1}/${waves.length}: ` +
      `[${waveRoles.join(', ')}] (${wave.length} agents)`,
    );

    // Split wave into chunks of MAX_CONCURRENT_AGENTS
    const chunks = chunkArray(wave, MAX_CONCURRENT_AGENTS);

    for (const chunk of chunks) {
      const promises = chunk.map(async (agent) => {
        // Concurrency guard: skip if already running
        const running = await isAgentRunning(agent.role);
        if (running) {
          console.log(`[ParallelDispatch] Skipping ${agent.role} — already running`);
          result.skipped.push(agent.role);
          return;
        }

        try {
          await withTimeout(
            executor(agent.role, agent.task, agent.context),
            DISPATCH_TIMEOUT_MS,
          );
          result.dispatched.push(agent.role);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[ParallelDispatch] ${agent.role} failed: ${msg}`);
          result.failed.push(agent.role);
        }
      });

      await Promise.allSettled(promises);
    }
  }

  console.log(
    `[ParallelDispatch] Complete: dispatched=${result.dispatched.length} ` +
    `skipped=${result.skipped.length} failed=${result.failed.length}`,
  );

  return result;
}

// ═══════════════════════════════════════════════════════════════════
// DEPENDENCY RESOLUTION — Event-driven dispatch after assignment completes
// ═══════════════════════════════════════════════════════════════════

/**
 * When an assignment completes, check if any dependent assignments now
 * have ALL dependencies met. If so, dispatch them immediately.
 *
 * Called from submit_assignment_output's event handler.
 */
export async function resolveAndDispatchDependents(
  completedAssignmentId: string,
  executor: AgentExecutorFn,
): Promise<{ dispatched: string[] }> {
  const dispatched: string[] = [];

  // Find assignments that depend on the completed one
  const dependents = await systemQuery<{
    id: string;
    assigned_to: string;
    task_description: string | null;
    instructions: string | null;
    depends_on: string[] | null;
    directive_id: string | null;
    fd_title: string | null;
    fd_priority: string | null;
    fd_description: string | null;
  }>(
    `SELECT wa.id, wa.assigned_to, wa.task_description, wa.expected_output AS instructions, wa.depends_on, wa.directive_id,
            fd.title as fd_title, fd.priority as fd_priority, fd.description as fd_description
     FROM work_assignments wa
     LEFT JOIN founder_directives fd ON wa.directive_id = fd.id
     WHERE wa.depends_on @> $1::jsonb AND wa.status = ANY($2)`,
    [JSON.stringify([completedAssignmentId]), ['pending', 'dispatched']],
  );

  if (!dependents.length) return { dispatched };

  for (const dep of dependents) {
    const allDeps: string[] = (dep.depends_on as string[]) ?? [];

    // Check if ALL dependencies are now completed
    const completed = await systemQuery<{ id: string }>(
      'SELECT id FROM work_assignments WHERE id = ANY($1) AND status = $2',
      [allDeps, 'completed'],
    );

    if (completed.length !== allDeps.length) continue;

    // All dependencies met — build enriched message with dependency outputs
    let enrichedMessage = (dep.instructions as string) || dep.task_description || '';

    for (const depId of allDeps) {
      const [depData] = await systemQuery<{
        assigned_to: string;
        task_description: string | null;
        agent_output: string | null;
      }>(
        'SELECT assigned_to, task_description, agent_output FROM work_assignments WHERE id = $1',
        [depId],
      );

      if (depData?.agent_output) {
        const depTitle = depData.task_description || depId;
        enrichedMessage += `\n\nDATA FROM ${depData.assigned_to} (${depTitle}):\n${depData.agent_output}`;
      }
    }

    const fd = (dep.fd_title || dep.fd_priority || dep.fd_description)
      ? { title: dep.fd_title, priority: dep.fd_priority, description: dep.fd_description }
      : null;
    let execMessage = `EXECUTE ASSIGNMENT: ${dep.task_description}\n`;
    if (fd?.title) execMessage += `Directive: ${fd.title}\n`;
    if (fd?.priority) execMessage += `Priority: ${fd.priority}\n\n`;
    execMessage += enrichedMessage;
    execMessage += `\n\nACTION MODE: This is not a report-only task. TAKE ACTION:`;
    execMessage += `\n- Fix issues you can fix directly → log what you did`;
    execMessage += `\n- Issues needing another agent → use send_agent_message with specifics`;
    execMessage += `\n- Blockers → flag immediately, don't just note them`;
    execMessage += `\n- Your output = punch list: what you fixed, what you assigned, what's blocked`;
    execMessage += `\n\nWhen complete: call submit_assignment_output(assignment_id="${dep.id}", output=..., status="completed")`;
    execMessage += `\nIf blocked: call flag_assignment_blocker(assignment_id="${dep.id}", blocker_reason=..., need_type=...)`;

    const agentRole = dep.assigned_to as CompanyAgentRole;

    // Concurrency guard
    const running = await isAgentRunning(agentRole);
    if (running) {
      console.log(`[ParallelDispatch] Dependency resolved but ${agentRole} already running — skipping`);
      continue;
    }

    // Mark as in_progress
    await systemQuery(
      'UPDATE work_assignments SET status = $1, dispatched_at = $2 WHERE id = $3',
      ['in_progress', new Date().toISOString(), dep.id],
    );

    console.log(
      `[ParallelDispatch] Dependency resolved: dispatching ${agentRole} ` +
      `(${dep.task_description}) — triggered by completion of ${completedAssignmentId}`,
    );

    try {
      // Fire-and-forget: don't await the full run
      executor(agentRole, 'work_loop', {
        message: execMessage,
        priority: 'reactive',
        wake_reason: 'dependency_resolved',
      }).catch(err => {
        console.error(`[ParallelDispatch] Dependent dispatch failed for ${agentRole}:`, (err as Error).message);
      });
      dispatched.push(agentRole);
    } catch (err) {
      console.error(`[ParallelDispatch] Failed to dispatch dependent ${agentRole}:`, (err as Error).message);
    }
  }

  if (dispatched.length > 0) {
    console.log(`[ParallelDispatch] Dispatched ${dispatched.length} dependent agents: [${dispatched.join(', ')}]`);
  }

  return { dispatched };
}

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Dispatch timeout after ${ms}ms`)), ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}
