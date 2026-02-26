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

import type { SupabaseClient } from '@supabase/supabase-js';
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
async function isAgentRunning(
  supabase: SupabaseClient,
  agentRole: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('agent_runs')
    .select('id')
    .eq('agent_id', agentRole)
    .eq('status', 'running')
    .limit(1);

  return (data?.length ?? 0) > 0;
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
  supabase: SupabaseClient,
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
        const running = await isAgentRunning(supabase, agent.role);
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
  supabase: SupabaseClient,
  executor: AgentExecutorFn,
): Promise<{ dispatched: string[] }> {
  const dispatched: string[] = [];

  // Find assignments that depend on the completed one
  const { data: dependents } = await supabase
    .from('work_assignments')
    .select('id, assigned_to, task_description, title, instructions, depends_on, directive_id, founder_directives(title, priority, description)')
    .contains('depends_on', [completedAssignmentId])
    .in('status', ['pending', 'dispatched']);

  if (!dependents?.length) return { dispatched };

  for (const dep of dependents) {
    const allDeps: string[] = (dep.depends_on as string[]) ?? [];

    // Check if ALL dependencies are now completed
    const { data: completed } = await supabase
      .from('work_assignments')
      .select('id')
      .in('id', allDeps)
      .eq('status', 'completed');

    if (completed?.length !== allDeps.length) continue;

    // All dependencies met — build enriched message with dependency outputs
    let enrichedMessage = (dep.instructions as string) || dep.task_description || '';

    for (const depId of allDeps) {
      const { data: depData } = await supabase
        .from('work_assignments')
        .select('assigned_to, title, task_description, agent_output')
        .eq('id', depId)
        .single();

      if (depData?.agent_output) {
        const depTitle = depData.title || depData.task_description || depId;
        enrichedMessage += `\n\nDATA FROM ${depData.assigned_to} (${depTitle}):\n${depData.agent_output}`;
      }
    }

    const fd = dep.founder_directives as { title?: string; priority?: string; description?: string } | null;
    let execMessage = `EXECUTE ASSIGNMENT: ${dep.title ?? dep.task_description}\n`;
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
    const running = await isAgentRunning(supabase, agentRole);
    if (running) {
      console.log(`[ParallelDispatch] Dependency resolved but ${agentRole} already running — skipping`);
      continue;
    }

    // Mark as in_progress
    await supabase.from('work_assignments')
      .update({ status: 'in_progress', started_at: new Date().toISOString() })
      .eq('id', dep.id);

    console.log(
      `[ParallelDispatch] Dependency resolved: dispatching ${agentRole} ` +
      `(${dep.title ?? dep.task_description}) — triggered by completion of ${completedAssignmentId}`,
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
