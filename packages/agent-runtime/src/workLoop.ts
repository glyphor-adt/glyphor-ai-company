/**
 * Work Loop — Universal always-on task handler
 *
 * Every agent runs through a priority stack on each heartbeat:
 *   P1 — URGENT: Assignments with status 'needs_revision' or urgent messages
 *   P2 — ACTIVE WORK: Assignments with status 'assigned'/'in_progress'/'dispatched'
 *   P3 — MESSAGES: Unread messages from colleagues
 *   P4 — SCHEDULED DUTIES: Normal job (briefings, monitoring, analysis, etc.)
 *   P5 — PROACTIVE: Self-directed work based on role
 *   P6 — NOTHING: Fast exit — "No actionable work. Standing by."
 *
 * The fast-exit check is pure DB queries — no LLM call, ~$0.005.
 * Only when real work exists does the agent load full context and run.
 */

import { systemQuery } from '@glyphor/shared/db';
import type { CompanyAgentRole } from './types.js';

/** Executive roles that manage teams and evaluate team output */
const EXECUTIVE_ROLES = new Set([
  'cto', 'cpo', 'cmo', 'cfo',
  'vp-sales', 'vp-design', 'vp-research',
]);

/** Appended to all P1/P2 assignment execution messages */
const ASSIGNMENT_FOOTER = `

AVAILABLE TOOLS: If any tool call fails with "not granted", call request_tool_access immediately and retry. Read-only tools approve instantly. Do not report tool access as a blocker.

SCOPE CONSTRAINT: Your task is defined above. Do not investigate, comment on, or report about topics outside your assignment. If you discover something concerning outside your scope, send_agent_message to the responsible agent — do not try to address it yourself.`;

// ═══════════════════════════════════════════════════════════════════
// PROACTIVE COOLDOWNS — How often each agent does self-directed work
// ═══════════════════════════════════════════════════════════════════

/** Proactive cooldown per role in milliseconds.
 *  This is the autonomous baseline cadence when no higher-priority work exists. */
export const PROACTIVE_COOLDOWNS: Record<string, number> = {
  // Tier 1: Executives — every 2h
  'chief-of-staff':      2 * 60 * 60 * 1000,
  'cto':                 2 * 60 * 60 * 1000,
  'cfo':                 2 * 60 * 60 * 1000,
  'cpo':                 2 * 60 * 60 * 1000,
  'cmo':                 2 * 60 * 60 * 1000,
  'vp-sales':            2 * 60 * 60 * 1000,
  'vp-design':           2 * 60 * 60 * 1000,
  'clo':                 2 * 60 * 60 * 1000,
  'vp-research':         2 * 60 * 60 * 1000,

  // Tier 2: Sub-team — every 4h
  'platform-engineer':   4 * 60 * 60 * 1000,
  'quality-engineer':    4 * 60 * 60 * 1000,
  'devops-engineer':     4 * 60 * 60 * 1000,
  'm365-admin':          4 * 60 * 60 * 1000,
  'user-researcher':     4 * 60 * 60 * 1000,
  'competitive-intel':   4 * 60 * 60 * 1000,
  'content-creator':     4 * 60 * 60 * 1000,
  'seo-analyst':         4 * 60 * 60 * 1000,
  'social-media-manager': 4 * 60 * 60 * 1000,
  'ui-ux-designer':      4 * 60 * 60 * 1000,
  'frontend-engineer':   4 * 60 * 60 * 1000,
  'design-critic':       4 * 60 * 60 * 1000,
  'template-architect':  4 * 60 * 60 * 1000,
  'head-of-hr':          4 * 60 * 60 * 1000,

  // Tier 3: Specialists — every 6h
  'bob-the-tax-pro':                6 * 60 * 60 * 1000,
  'marketing-intelligence-analyst': 6 * 60 * 60 * 1000,
  'adi-rose':                       6 * 60 * 60 * 1000,

  // Tier 4: Operations
  'ops':            1 * 60 * 60 * 1000,
  'global-admin':   4 * 60 * 60 * 1000,
};

const ROLE_DEPARTMENT: Record<string, string> = {
  'chief-of-staff': 'operations',
  ops: 'operations',
  'global-admin': 'operations',
  'head-of-hr': 'operations',
  'adi-rose': 'operations',
  cto: 'engineering',
  'platform-engineer': 'engineering',
  'quality-engineer': 'engineering',
  'devops-engineer': 'engineering',
  'm365-admin': 'engineering',
  cpo: 'product',
  'user-researcher': 'product',
  'competitive-intel': 'product',
  cfo: 'finance',
  clo: 'legal',
  'bob-the-tax-pro': 'legal',
  cmo: 'marketing',
  'content-creator': 'marketing',
  'seo-analyst': 'marketing',
  'social-media-manager': 'marketing',
  'marketing-intelligence-analyst': 'marketing',
  'vp-sales': 'sales',
  'vp-design': 'design',
  'ui-ux-designer': 'design',
  'frontend-engineer': 'design',
  'design-critic': 'design',
  'template-architect': 'design',
  'vp-research': 'research',
  'competitive-research-analyst': 'research',
  'market-research-analyst': 'research',
};

const DEPARTMENT_ROLE_GROUPS: Record<string, string[]> = {
  operations: ['chief-of-staff', 'ops', 'global-admin', 'head-of-hr', 'adi-rose'],
  engineering: ['cto', 'platform-engineer', 'quality-engineer', 'devops-engineer', 'm365-admin'],
  product: ['cpo', 'user-researcher', 'competitive-intel'],
  finance: ['cfo'],
  legal: ['clo', 'bob-the-tax-pro'],
  marketing: ['cmo', 'content-creator', 'seo-analyst', 'social-media-manager', 'marketing-intelligence-analyst'],
  sales: ['vp-sales'],
  design: ['vp-design', 'ui-ux-designer', 'frontend-engineer', 'design-critic', 'template-architect'],
  research: ['vp-research', 'competitive-research-analyst', 'market-research-analyst'],
};

const DEPARTMENT_DIRECTIVE_CATEGORIES: Record<string, string[]> = {
  operations: ['operations', 'general'],
  engineering: ['engineering'],
  product: ['product'],
  finance: ['revenue', 'operations', 'general'],
  legal: ['general'],
  marketing: ['marketing'],
  sales: ['sales'],
  design: ['design'],
  research: ['general'],
};

// ═══════════════════════════════════════════════════════════════════
// WORK LOOP RESULT
// ═══════════════════════════════════════════════════════════════════

export interface WorkLoopResult {
  /** Whether the agent should be dispatched for a full run */
  shouldRun: boolean;
  /** Context tier to use for the run */
  contextTier?: 'light' | 'task' | 'standard' | 'full';
  /** Task to dispatch (overrides default) */
  task?: string;
  /** Why the agent is waking (for logging) */
  reason?: string;
  /** Priority level that triggered the wake */
  priority?: 1 | 1.5 | 2 | 3 | 4 | 5 | 6;
  /** Message to pass to the agent */
  message?: string;
}

// ═══════════════════════════════════════════════════════════════════
// EXECUTE WORK LOOP — Fast pre-check before committing to a full run
// ═══════════════════════════════════════════════════════════════════

/**
 * Check if an agent has actionable work. Pure DB queries, no LLM.
 * Returns whether the agent should be dispatched and with what parameters.
 */
export async function executeWorkLoop(
  agentRole: CompanyAgentRole,
): Promise<WorkLoopResult> {
  // ── P1: URGENT — Assignments needing revision ──────────────
  // Checked FIRST so P1 work always runs regardless of abort cooldown.
  const revisionAssignments = await systemQuery<{
    id: string;
    task_description: string;
    instructions: unknown;
    status: string;
    evaluation: unknown;
    assigned_to: string;
    founder_directives: { title?: string; priority?: string; description?: string } | null;
  }>(
    `SELECT wa.id, wa.task_description, wa.expected_output AS instructions, wa.status, wa.evaluation, wa.assigned_to,
            json_build_object('title', fd.title, 'priority', fd.priority, 'description', fd.description) AS founder_directives
     FROM work_assignments wa
     LEFT JOIN founder_directives fd ON wa.directive_id = fd.id
     WHERE wa.assigned_to = $1 AND wa.status = 'needs_revision'
     LIMIT 5`,
    [agentRole],
  );

  if (revisionAssignments && revisionAssignments.length > 0) {
    const assignment = revisionAssignments[0];
    const fd = assignment.founder_directives as { title?: string; priority?: string; description?: string } | null;

    // Mark as in_progress at dispatch time
    await systemQuery(
      'UPDATE work_assignments SET status = $1, dispatched_at = $2 WHERE id = $3',
      ['in_progress', new Date().toISOString(), assignment.id],
    );

    let execMessage = `REVISION REQUIRED: ${assignment.task_description}\n`;
    if (fd?.title) execMessage += `Directive: ${fd.title}\n`;
    if (fd?.priority) execMessage += `Priority: ${fd.priority}\n\n`;
    execMessage += (assignment.instructions as string) || assignment.task_description;

    if (assignment.evaluation) {
      execMessage += `\n\nREVISION FEEDBACK (address these issues):\n`;
      execMessage += typeof assignment.evaluation === 'string'
        ? assignment.evaluation
        : JSON.stringify(assignment.evaluation);
    }

    execMessage += `\n\nWhen complete: call submit_assignment_output(assignment_id="${assignment.id}", output=..., status="completed")`;
    execMessage += `\nIf blocked: call flag_assignment_blocker(assignment_id="${assignment.id}", blocker_reason=..., need_type=...)`;
    execMessage += ASSIGNMENT_FOOTER;

    return {
      shouldRun: true,
      contextTier: 'task',
      task: 'work_loop',
      reason: `revision_needed:${revisionAssignments.length}`,
      priority: 1,
      message: execMessage,
    };
  }

  // Also check for urgent messages (still P1, bypasses cooldown)
  const [urgentMsgResult] = await systemQuery<{ count: number }>(
    `SELECT COUNT(*) as count FROM agent_messages WHERE to_agent = $1 AND status = 'pending' AND priority = 'urgent'`,
    [agentRole],
  );
  const urgentMsgCount = urgentMsgResult?.count ?? 0;

  if (urgentMsgCount && urgentMsgCount > 0) {
    return {
      shouldRun: true,
      contextTier: 'standard',
      task: 'work_loop',
      reason: `urgent_messages:${urgentMsgCount}`,
      priority: 1,
      message: `You have ${urgentMsgCount} urgent message(s). Handle them immediately.`,
    };
  }

  // Also check for team member blockers (P1 for executives)
  if (EXECUTIVE_ROLES.has(agentRole)) {
    const teamBlockers = await systemQuery<{
      id: string; assigned_to: string; task_description: string; total_count: number;
    }>(
      "SELECT id, assigned_to, task_description, COUNT(*) OVER()::int AS total_count FROM work_assignments WHERE assigned_by = $1 AND status = 'blocked' ORDER BY updated_at DESC LIMIT 5",
      [agentRole],
    );
    const teamBlockerCount = teamBlockers?.[0]?.total_count ?? 0;

    if (teamBlockerCount > 0) {
      const summaries = (teamBlockers ?? [])
        .map(b => `- ${b.assigned_to}: ${(b.task_description ?? '').slice(0, 80)} (ID: ${b.id})`)
        .join('\n');

      return {
        shouldRun: true,
        contextTier: 'standard',
        task: 'work_loop',
        reason: `team_blockers:${teamBlockerCount}`,
        priority: 1,
        message:
          `${teamBlockerCount} team member(s) are blocked on assignments you created.\n` +
          `${summaries}\n\n` +
          `Use check_team_status (or check_team_assignments) to review details. ` +
          `Guardrail: only the assignee can call submit_assignment_output or flag_assignment_blocker. ` +
          `For team-owned blockers, coordinate via send_agent_message and escalate_to_sarah only for cross-functional unblock needs.`,
      };
    }
  }

  // ── P1.5: TEAM EVALUATION — Completed team work needing review (executives only)
  if (EXECUTIVE_ROLES.has(agentRole)) {
    const teamCompletedAssignments = await systemQuery<{
      id: string; assigned_to: string; task_description: string; agent_output: string;
    }>(
      "SELECT id, assigned_to, task_description, agent_output FROM work_assignments WHERE assigned_by = $1 AND status = 'completed' AND quality_score IS NULL LIMIT 5",
      [agentRole],
    );

    if (teamCompletedAssignments && teamCompletedAssignments.length > 0) {
      const summaries = teamCompletedAssignments
        .map(a => `- ${a.assigned_to}: ${(a.task_description ?? '').slice(0, 80)} (ID: ${a.id})`)
        .join('\n');

      return {
        shouldRun: true,
        contextTier: 'standard',
        task: 'work_loop',
        reason: `team_evaluation:${teamCompletedAssignments.length}`,
        priority: 1.5,
        message: `${teamCompletedAssignments.length} completed team assignment(s) need your review:\n${summaries}\n\nUse review_team_output to evaluate each one — accept, revise, or reassign.`,
      };
    }
  }

  // ── ABORT COOLDOWN — Exponential backoff, applied after P1 ──
  // 1 consecutive abort → 5 min, 2 → 10 min, 3 → 20 min, 4+ → 30 min (cap)
  const recentAborts = await systemQuery<{ completed_at: string; status: string; error: string | null }>(
    'SELECT completed_at, status, error FROM agent_runs WHERE agent_id = $1 ORDER BY completed_at DESC LIMIT 10',
    [agentRole],
  );

  if (recentAborts && recentAborts.length > 0) {    // Count consecutive aborts (stop at the first non-aborted run)
    let consecutiveAborts = 0;
    let lastAbortReason: AbortReason | null = null;
    for (const run of recentAborts) {
      if (run.status !== 'aborted') break;
      const abortReason = classifyAbortReason(run.error);
      if (lastAbortReason == null) {
        lastAbortReason = abortReason;
      }
      if (abortReason !== lastAbortReason) break;
      consecutiveAborts++;
    }

    if (consecutiveAborts > 0) {
      const lastAbortedAt = new Date(recentAborts[0].completed_at).getTime();
      const cooldownMs = getAbortCooldownMs(lastAbortReason ?? 'error', consecutiveAborts);
      const elapsed = Date.now() - lastAbortedAt;

      if (elapsed < cooldownMs) {
        return {
          shouldRun: false,
          reason: `abort_cooldown:${lastAbortReason ?? 'error'}:${Math.round((cooldownMs - elapsed) / 60_000)}min_remaining(${consecutiveAborts}_consecutive)`,
          priority: 6,
        };
      }
    }
  }

  // ── P2: ACTIVE WORK — Pending/dispatched/in-progress assignments ──
  // Note: 'draft' status is intentionally excluded — drafts await plan verification
  // before being promoted to 'pending' and entering the work loop.
  const activeAssignments = await systemQuery<{
    id: string;
    task_description: string;
    instructions: unknown;
    status: string;
    priority: string;
    evaluation: unknown;
    assigned_to: string;
    assigned_by: string | null;
    updated_at: string | null;
    assignment_type: string | null;
    founder_directives: { title?: string; priority?: string; description?: string } | null;
  }>(
    `SELECT wa.id, wa.task_description, wa.expected_output AS instructions, wa.status, wa.evaluation, wa.assigned_to,
            wa.priority, wa.assigned_by, wa.updated_at, wa.assignment_type,
            json_build_object('title', fd.title, 'priority', fd.priority, 'description', fd.description) AS founder_directives
      FROM work_assignments wa
      LEFT JOIN founder_directives fd ON wa.directive_id = fd.id
     WHERE wa.assigned_to = $1 AND wa.status = ANY($2)
     ORDER BY wa.created_at ASC
     LIMIT 5`,
    [agentRole, ['pending', 'dispatched', 'in_progress']],
  );

  if (activeAssignments && activeAssignments.length > 0) {
    const staleAssignmentThresholdMs = 2 * 60 * 60 * 1000;
    const actionableAssignments: typeof activeAssignments = [];

    for (const assignment of activeAssignments) {
      const isStaleInProgress = assignment.status === 'in_progress'
        && assignment.updated_at != null
        && (Date.now() - new Date(assignment.updated_at).getTime()) > staleAssignmentThresholdMs;

      if (!isStaleInProgress) {
        actionableAssignments.push(assignment);
        continue;
      }

      await systemQuery(
        `UPDATE work_assignments
         SET status = $1,
             blocker_reason = $2,
             updated_at = NOW()
         WHERE id = $3`,
        ['blocked', 'Auto-escalated: in_progress for > 2 hours without update', assignment.id],
      );

      if (assignment.assigned_by && assignment.assigned_by !== assignment.assigned_to) {
        await systemQuery(
          `INSERT INTO agent_messages (from_agent, to_agent, message, message_type, priority, status)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            'ops',
            assignment.assigned_by,
            `Auto-escalation: assignment ${assignment.id} for ${assignment.assigned_to} was marked blocked after more than 2 hours without progress.\n\nTask: ${assignment.task_description}`,
            'followup',
            'urgent',
            'pending',
          ],
        );
      }
    }

    const standardAssignments = actionableAssignments.filter(
      (assignment) => assignment.assignment_type !== 'peer_request',
    );
    const peerAssignments = actionableAssignments.filter(
      (assignment) => assignment.assignment_type === 'peer_request',
    );

    // Sort: needs_revision first (handled above), then by directive priority
    const priorityOrder: Record<string, number> = { critical: 0, urgent: 0, high: 1, medium: 2, normal: 2, low: 3 };
    const sortAssignments = (assignments: typeof activeAssignments) => [...assignments].sort((a, b) => {
      const fd_a = a.founder_directives as { priority?: string } | null;
      const fd_b = b.founder_directives as { priority?: string } | null;
      const ap = priorityOrder[(fd_a?.priority ?? a.priority ?? 'medium').toLowerCase()] ?? 3;
      const bp = priorityOrder[(fd_b?.priority ?? b.priority ?? 'medium').toLowerCase()] ?? 3;
      return ap - bp;
    });

    if (standardAssignments.length > 0) {
      const assignment = sortAssignments(standardAssignments)[0];
      const fd = assignment.founder_directives as { title?: string; priority?: string; description?: string } | null;

      // Mark as in_progress at dispatch time
      if (assignment.status === 'dispatched' || assignment.status === 'pending') {
        await systemQuery(
          'UPDATE work_assignments SET status = $1, dispatched_at = $2, updated_at = NOW() WHERE id = $3',
          ['in_progress', new Date().toISOString(), assignment.id],
        );
      }

      // Build execution message with full context embedded
      let execMessage = `EXECUTE ASSIGNMENT: ${assignment.task_description}\n`;
      if (fd?.title) execMessage += `Directive: ${fd.title}\n`;
      if (fd?.priority) execMessage += `Priority: ${fd.priority}\n\n`;
      execMessage += (assignment.instructions as string) || assignment.task_description;

      if (assignment.status === 'needs_revision' && assignment.evaluation) {
        execMessage += `\n\nFEEDBACK (address these issues):\n`;
        execMessage += typeof assignment.evaluation === 'string'
          ? assignment.evaluation
          : JSON.stringify(assignment.evaluation);
      }

      execMessage += `\n\nWhen complete: call submit_assignment_output(assignment_id="${assignment.id}", output=..., status="completed")`;
      execMessage += `\nIf blocked: call flag_assignment_blocker(assignment_id="${assignment.id}", blocker_reason=..., need_type=...)`;
      execMessage += ASSIGNMENT_FOOTER;

      return {
        shouldRun: true,
        contextTier: 'task',
        task: 'work_loop',
        reason: `active_assignments:${standardAssignments.length}`,
        priority: 2,
        message: execMessage,
      };
    }

    if (peerAssignments.length > 0) {
      const assignment = sortAssignments(peerAssignments)[0];
      if (assignment.status === 'dispatched' || assignment.status === 'pending') {
        await systemQuery(
          'UPDATE work_assignments SET status = $1, dispatched_at = $2, updated_at = NOW() WHERE id = $3',
          ['in_progress', new Date().toISOString(), assignment.id],
        );
      }

      return {
        shouldRun: true,
        contextTier: 'standard',
        task: 'work_loop',
        reason: `peer_requests:${peerAssignments.length}`,
        priority: 3,
        message: `PEER WORK REQUEST from ${assignment.assigned_by ?? 'a colleague'} (priority: ${assignment.priority}):\n${assignment.task_description}\n\nExpected deliverable:\n${(assignment.instructions as string) || 'Provide the requested output.'}\n\nWhen complete: call submit_assignment_output(assignment_id="${assignment.id}", output=..., status="completed").`,
      };
    }
  }

  // ── P3: MESSAGES — Unread messages from colleagues ─────────
  const [pendingMsgResult] = await systemQuery<{ count: number }>(
    `SELECT COUNT(*) as count FROM agent_messages WHERE to_agent = $1 AND status = 'pending'`,
    [agentRole],
  );
  const pendingMsgCount = pendingMsgResult?.count ?? 0;

  if (pendingMsgCount && pendingMsgCount > 0) {
    return {
      shouldRun: true,
      contextTier: 'standard',
      task: 'work_loop',
      reason: `pending_messages:${pendingMsgCount}`,
      priority: 3,
      message: `You have ${pendingMsgCount} unread message(s) from colleagues.`,
    };
  }

  // ── P4: SCHEDULED DUTIES — Handled externally by cron; skip here ──
  // Scheduled duties (morning briefings, cost checks, etc.) are triggered
  // by Cloud Scheduler crons, not the heartbeat work_loop. Skip.

  // ── P5: PROACTIVE — Self-directed work if cooldown expired ──
  // Roles listed in PROACTIVE_COOLDOWNS autonomously identify high-value work.
  let cooldownMs = getProactiveCooldown(agentRole);
  if (cooldownMs != null) {
    // Guard: if last 3+ consecutive runs were proactive aborts, disable proactive
    // entirely until a non-proactive successful run breaks the cycle.
    const recentForProactiveGuard = await systemQuery<{ task: string; status: string }>(
      `SELECT task, status FROM agent_runs WHERE agent_id = $1 ORDER BY completed_at DESC LIMIT 5`,
      [agentRole],
    );
    let consecutiveProactiveAborts = 0;
    for (const run of recentForProactiveGuard) {
      if (run.task === 'proactive' && run.status === 'aborted') consecutiveProactiveAborts++;
      else break;
    }
    if (consecutiveProactiveAborts >= 3) {
      return {
        shouldRun: false,
        reason: `proactive_disabled:${consecutiveProactiveAborts}_consecutive_aborts`,
        priority: 6,
      };
    }

    // Check if last 3 proactive runs produced no tool calls — if so, double cooldown
    const recentProactive = await systemQuery<{ turns: number }>(
      `SELECT turns FROM agent_runs WHERE agent_id = $1 AND task = 'proactive' AND status = 'completed'
       ORDER BY completed_at DESC LIMIT 3`,
      [agentRole],
    );
    const emptyRuns = recentProactive.filter(r => (r.turns ?? 0) === 0).length;
    if (emptyRuns >= 3) {
      cooldownMs = cooldownMs * 2; // Double cooldown for agents producing empty proactive runs
    }

    const proactiveDirectiveGate = await checkProactiveDirectiveCoverage(agentRole);
    if (!proactiveDirectiveGate.allowed) {
      return {
        shouldRun: false,
        reason: `proactive_blocked:no_active_directive:${proactiveDirectiveGate.department ?? 'unmapped'}`,
        priority: 6,
      };
    }

    const objectiveWork = await checkStandingObjectives(agentRole);
    if (objectiveWork) {
      return objectiveWork;
    }

    const lastMeaningfulRun = await getLastMeaningfulRunTime(agentRole);
    if (Date.now() - lastMeaningfulRun > cooldownMs) {
      return {
        shouldRun: true,
        contextTier: 'standard',
        task: 'proactive',
        reason: 'proactive_cooldown_expired',
        priority: 5,
        message: buildProactivePrompt(agentRole),
      };
    }
  }

  // ── P6: NOTHING — Fast exit ───────────────────────────────
  return {
    shouldRun: false,
    reason: 'no_work',
    priority: 6,
  };
}

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

/**
 * Get the timestamp of the last meaningful run (not a fast-exit heartbeat).
 * Returns epoch 0 if no runs found (so first proactive always triggers).
 */
async function getLastMeaningfulRunTime(
  agentRole: CompanyAgentRole,
): Promise<number> {
  const [data] = await systemQuery<{ completed_at: string }>(
    'SELECT completed_at FROM agent_runs WHERE agent_id = $1 AND status = $2 AND turns > 0 ORDER BY completed_at DESC LIMIT 1',
    [agentRole, 'completed'],
  );

  if (data?.completed_at) {
    return new Date(data.completed_at).getTime();
  }
  return 0;
}

type AbortReason = 'max_turns_exceeded' | 'timeout' | 'stall_detected' | 'error';

const ABORT_COOLDOWN_MAP: Record<AbortReason, number> = {
  max_turns_exceeded: 5 * 60 * 1000,
  timeout: 10 * 60 * 1000,
  stall_detected: 15 * 60 * 1000,
  error: 30 * 60 * 1000,
};

function classifyAbortReason(error: string | null): AbortReason {
  if (!error) return 'error';
  const normalized = error.toLowerCase();
  if (normalized.includes('max_turns_exceeded')) return 'max_turns_exceeded';
  if (normalized.includes('deadline_exceeded') || normalized.includes('timed out') || normalized.includes('timeout')) {
    return 'timeout';
  }
  if (normalized.includes('stall')) return 'stall_detected';
  return 'error';
}

function getAbortCooldownMs(reason: AbortReason, consecutiveAborts: number): number {
  const baseCooldown = ABORT_COOLDOWN_MAP[reason] ?? ABORT_COOLDOWN_MAP.error;
  return Math.min(baseCooldown * Math.pow(2, Math.max(0, consecutiveAborts - 1)), 60 * 60 * 1000);
}

function getProactiveCooldown(agentRole: CompanyAgentRole): number | undefined {
  return PROACTIVE_COOLDOWNS[agentRole];
}

async function checkProactiveDirectiveCoverage(
  agentRole: CompanyAgentRole,
): Promise<{ allowed: boolean; department?: string }> {
  const department = ROLE_DEPARTMENT[agentRole];
  if (!department) {
    return { allowed: true };
  }

  const targetRoles = DEPARTMENT_ROLE_GROUPS[department] ?? [agentRole];
  const categories = DEPARTMENT_DIRECTIVE_CATEGORIES[department] ?? [];
  const [row] = await systemQuery<{ id: string }>(
    `SELECT id
       FROM founder_directives
      WHERE status = 'active'
        AND (
          COALESCE(target_agents, ARRAY[]::text[]) && $1::text[]
          OR category = ANY($2::text[])
        )
      LIMIT 1`,
    [targetRoles, categories],
  );

  return {
    allowed: Boolean(row?.id),
    department,
  };
}

async function checkStandingObjectives(agentRole: CompanyAgentRole): Promise<WorkLoopResult | null> {
  try {
    const [objective] = await systemQuery<{
      id: string;
      objective: string;
      success_metric: string;
      priority: string;
    }>(
      `SELECT id, objective, success_metric, priority
       FROM standing_objectives
       WHERE agent_role = $1
         AND active = true
         AND (last_checked_at IS NULL OR last_checked_at < NOW() - check_frequency)
       ORDER BY
         CASE priority
           WHEN 'critical' THEN 0
           WHEN 'high' THEN 1
           WHEN 'medium' THEN 2
           WHEN 'low' THEN 3
           ELSE 4
         END,
         last_checked_at ASC NULLS FIRST
       LIMIT 1`,
      [agentRole],
    );

    if (!objective) {
      return null;
    }

    await systemQuery(
      'UPDATE standing_objectives SET last_checked_at = NOW(), updated_at = NOW() WHERE id = $1',
      [objective.id],
    );

    return {
      shouldRun: true,
      contextTier: 'standard',
      task: 'proactive',
      reason: `standing_objective:${objective.id}`,
      priority: 5,
      message: [
        `STANDING OBJECTIVE: ${objective.objective}`,
        `SUCCESS METRIC: ${objective.success_metric}`,
        `PRIORITY: ${objective.priority}`,
        '',
        'Instructions:',
        '1. Check the current state of this metric using your available tools.',
        '2. If the metric is not met, take concrete action to improve it.',
        '3. If the metric is met, briefly confirm status with supporting evidence.',
        '4. Save a memory summarizing what you found and any action you took.',
        '5. If you are blocked, send_agent_message to your manager with the blocker and next step needed.',
      ].join('\n'),
    };
  } catch {
    return null;
  }
}

/** Role-specific proactive work prompts */
const PROACTIVE_PROMPTS: Record<string, string> = {
  'chief-of-staff': `PROACTIVE WORK — Choose ONE high-value initiative:
1. DIRECTIVE HEALTH: Check all active directives for stale assignments (no progress in 48h+). If found, message the assigned executive.
2. CROSS-DEPARTMENT PATTERNS: Review recent agent outputs across departments — are multiple teams flagging the same issue? If so, propose a coordinated response.
3. FOUNDER ALIGNMENT: Check if any directive outcomes have drifted from original intent. If so, update progress notes and re-align assignments.
4. CAPACITY BALANCE: Check assignment distribution across executives. If any exec has >5 active while another has <2, rebalance.
5. INITIATIVE: If you've identified a recurring cross-department pattern across 3+ runs, propose a new directive to address it systemically.
Pick the one with the highest potential impact. Execute it — don't just report on it.`,

  'cto': `PROACTIVE WORK — Choose ONE high-value initiative:
1. COST OPTIMIZATION: Query ai_usage for the last 7 days. Find any agent spending >120% of budget. If found, propose a model downgrade or schedule change.
2. RELIABILITY: Check last 24h of agent_runs for timeout/failure rates >15%. If found, investigate root cause and fix or create_github_issue.
3. PERFORMANCE: Compare current cold-start times to last month. If degraded >20%, investigate container size or dependency bloat.
4. TECH DEBT: Check for any open GitHub issues labeled 'tech-debt' older than 14 days. If found, triage and assign or close stale ones.
5. INITIATIVE: If you've identified a recurring infrastructure pattern across 3+ runs, use propose_initiative to formally propose a project to address it.
Pick the one with the highest potential impact. Execute it — don't just report on it.`,

  'cfo': `PROACTIVE WORK — Choose ONE high-value initiative:
1. COST ANOMALY: Compare today's running costs to 7-day average. Flag anything >30% above.
2. REVENUE TREND: Check MRR trend over last 30 days. If declining, draft alert for founders.
3. UNIT ECONOMICS: Calculate cost-per-agent-run trend. Is it improving or degrading?
4. VENDOR AUDIT: Check vendor_subscriptions for any subscription with $0 usage in 30 days.
5. INITIATIVE: If you've identified a recurring financial pattern across 3+ runs, use propose_initiative to propose a cost optimization or revenue project.
Pick the one with the highest potential impact. Execute it — don't just report on it.`,

  'cpo': `PROACTIVE WORK — Choose ONE high-value initiative:
1. USAGE SIGNALS: Check product usage metrics for declining engagement patterns.
2. COMPETITIVE MOVE: Web search top 3 competitors for new feature announcements this week.
3. ROADMAP HEALTH: Check product_proposals for any stale (>30 days) proposals. Update or close.
4. FEATURE GAP: Cross-reference customer_health churn reasons with current roadmap items.
5. INITIATIVE: If you've identified a recurring product pattern across 3+ runs, use propose_initiative to propose a product improvement project.
Pick the one with the highest potential impact. Execute it — don't just report on it.`,

  'cmo': `PROACTIVE WORK — Choose ONE high-value initiative:
1. CONTENT GAP: Check content calendar for any days this week with no scheduled content. If found, draft and schedule content.
2. SEO OPPORTUNITY: Query Search Console for keywords with high impressions but low clicks.
3. SOCIAL ENGAGEMENT: Review last week's social media performance. Double down on what worked.
4. BRAND MONITORING: Web search "Glyphor" and "Pulse AI" for new mentions or reviews.
5. INITIATIVE: If you've identified a recurring marketing pattern across 3+ runs, use propose_initiative to propose a marketing campaign or growth project.
Pick the one with the highest potential impact. Execute it — don't just report on it.`,

  'vp-sales': `PROACTIVE WORK — Choose ONE high-value initiative:
1. PIPELINE HEALTH: Check pipeline stage conversion rates. If any stage has >50% drop-off, investigate.
2. PROSPECT RESEARCH: Research top 3 prospects in the pipeline — find recent news, funding, or hiring signals.
3. WIN/LOSS ANALYSIS: Review last 5 closed deals. Identify patterns in wins vs losses.
4. OUTREACH: Draft personalized outreach for the highest-priority prospect not yet contacted.
5. INITIATIVE: If you've identified a recurring sales pattern across 3+ runs, use propose_initiative to propose a sales process improvement.
Pick the one with the highest potential impact. Execute it — don't just report on it.`,

  'vp-design': `PROACTIVE WORK — Choose ONE high-value initiative:
1. QUALITY AUDIT: Run Lighthouse on key pages. If any score <80, identify and fix the issue.
2. COMPONENT CONSISTENCY: Check design system for any components used inconsistently across pages.
3. TEMPLATE FRESHNESS: Review templates for any older than 90 days. Update or deprecate.
4. ACCESSIBILITY: Check top 3 pages for WCAG compliance issues. Fix any critical violations.
5. INITIATIVE: If you've identified a recurring design quality pattern across 3+ runs, use propose_initiative to propose a design system improvement.
Pick the one with the highest potential impact. Execute it — don't just report on it.`,

  'vp-research': `PROACTIVE WORK — Choose ONE high-value initiative:
1. MARKET SHIFT: Web search for major industry developments in the last 7 days that affect our positioning.
2. COMPETITOR INTELLIGENCE: Check top 3 competitors for new product launches, pricing changes, or funding rounds.
3. TREND ANALYSIS: Identify emerging technology trends relevant to our product roadmap.
4. KNOWLEDGE GAP: Review the knowledge graph for stale or missing research topics. Update the most critical one.
5. INITIATIVE: If you've identified a recurring market pattern across 3+ runs, use propose_initiative to propose a strategic research project.
Pick the one with the highest potential impact. Execute it — don't just report on it.`,

  'ops': `PROACTIVE WORK — Choose ONE high-value initiative:
1. SYSTEM HEALTH: Full infra health scan — check all Cloud Run services, database connections, and queue depths.
2. DATA FRESHNESS: Check data_sync_status for any stale data sources (>24h since last sync). If found, investigate and trigger refresh.
3. COST ANOMALY: Check cloud billing for any service with >50% cost increase day-over-day.
4. AGENT HEALTH: Review agent_runs for agents with >30% failure rate in the last 24h. Investigate root cause.
5. INITIATIVE: If you've identified a recurring ops pattern across 3+ runs, use propose_initiative to propose an infrastructure improvement.
Pick the one with the highest potential impact. Execute it — don't just report on it.`,
};

const DEFAULT_PROACTIVE_PROMPT = `PROACTIVE WORK: Identify ONE concrete improvement in your domain that you can execute right now. Do not produce a report — take action. Fix something, create something, or message a colleague about something specific.`;

function buildProactivePrompt(agentRole: string): string {
  const rolePrompt = PROACTIVE_PROMPTS[agentRole] ?? DEFAULT_PROACTIVE_PROMPT;

  // Org awareness: check messages first, share findings after
  const orgAwareness = `\n\nBefore starting proactive work, check_messages first. If a colleague has messaged you, respond to that instead — colleague requests are higher priority than self-directed work.\n\nAfter completing proactive work, ask yourself: does any other agent need to know about what I found? If yes, send_agent_message with a concise summary.`;

  return rolePrompt + orgAwareness;
}
