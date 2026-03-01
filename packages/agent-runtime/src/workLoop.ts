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

// ═══════════════════════════════════════════════════════════════════
// PROACTIVE COOLDOWNS — How often each agent does self-directed work
// ═══════════════════════════════════════════════════════════════════

/** Proactive cooldown per role in milliseconds.
 *  Only roles explicitly listed here are eligible for proactive (P5) work.
 *  Sub-team agents are intentionally excluded during stabilization. */
export const PROACTIVE_COOLDOWNS: Record<string, number> = {
  // Always Hot — 1 hour
  'chief-of-staff': 60 * 60 * 1000,
  'ops':            60 * 60 * 1000,

  // High Frequency — 2 hours
  'cto': 2 * 60 * 60 * 1000,
  'cfo': 2 * 60 * 60 * 1000,

  // Medium — 4 hours
  'cpo':                 4 * 60 * 60 * 1000,
  'cmo':                 4 * 60 * 60 * 1000,
  'vp-customer-success': 4 * 60 * 60 * 1000,
  'vp-sales':            4 * 60 * 60 * 1000,
  'vp-design':           4 * 60 * 60 * 1000,
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
  priority?: 1 | 2 | 3 | 4 | 5 | 6;
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
    title: string | null;
    instructions: unknown;
    status: string;
    evaluation: unknown;
    assigned_to: string;
    founder_directives: { title?: string; priority?: string; description?: string } | null;
  }>(
    `SELECT wa.id, wa.task_description, wa.title, wa.instructions, wa.status, wa.evaluation, wa.assigned_to,
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
      'UPDATE work_assignments SET status = $1, started_at = $2 WHERE id = $3',
      ['in_progress', new Date().toISOString(), assignment.id],
    );

    let execMessage = `REVISION REQUIRED: ${assignment.title ?? assignment.task_description}\n`;
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

  // ── ABORT COOLDOWN — Exponential backoff, applied after P1 ──
  // 1 consecutive abort → 5 min, 2 → 10 min, 3 → 20 min, 4+ → 30 min (cap)
  const recentAborts = await systemQuery<{ completed_at: string; status: string }>(
    'SELECT completed_at, status FROM agent_runs WHERE agent_id = $1 ORDER BY completed_at DESC LIMIT 10',
    [agentRole],
  );

  if (recentAborts && recentAborts.length > 0) {    // Count consecutive aborts (stop at the first non-aborted run)
    let consecutiveAborts = 0;
    for (const run of recentAborts) {
      if (run.status === 'aborted') consecutiveAborts++;
      else break;
    }

    if (consecutiveAborts > 0) {
      const lastAbortedAt = new Date(recentAborts[0].completed_at).getTime();
      // Exponential backoff: 5min * 2^(n-1), capped at 30 min
      const cooldownMs = Math.min(5 * 60 * 1000 * Math.pow(2, consecutiveAborts - 1), 30 * 60 * 1000);
      const elapsed = Date.now() - lastAbortedAt;

      if (elapsed < cooldownMs) {
        return {
          shouldRun: false,
          reason: `abort_cooldown:${Math.round((cooldownMs - elapsed) / 60_000)}min_remaining(${consecutiveAborts}_consecutive)`,
          priority: 6,
        };
      }
    }
  }

  // ── P2: ACTIVE WORK — Pending/dispatched/in-progress assignments ──
  const activeAssignments = await systemQuery<{
    id: string;
    task_description: string;
    title: string | null;
    instructions: unknown;
    status: string;
    evaluation: unknown;
    assigned_to: string;
    founder_directives: { title?: string; priority?: string; description?: string } | null;
  }>(
    `SELECT wa.id, wa.task_description, wa.title, wa.instructions, wa.status, wa.evaluation, wa.assigned_to,
            json_build_object('title', fd.title, 'priority', fd.priority, 'description', fd.description) AS founder_directives
     FROM work_assignments wa
     LEFT JOIN founder_directives fd ON wa.directive_id = fd.id
     WHERE wa.assigned_to = $1 AND wa.status = ANY($2)
     ORDER BY wa.created_at ASC
     LIMIT 5`,
    [agentRole, ['pending', 'dispatched', 'in_progress']],
  );

  if (activeAssignments && activeAssignments.length > 0) {
    // Sort: needs_revision first (handled above), then by directive priority
    const priorityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    const sorted = [...activeAssignments].sort((a, b) => {
      const fd_a = a.founder_directives as { priority?: string } | null;
      const fd_b = b.founder_directives as { priority?: string } | null;
      const ap = priorityOrder[fd_a?.priority ?? 'medium'] ?? 3;
      const bp = priorityOrder[fd_b?.priority ?? 'medium'] ?? 3;
      return ap - bp;
    });

    const assignment = sorted[0];
    const fd = assignment.founder_directives as { title?: string; priority?: string; description?: string } | null;

    // Mark as in_progress at dispatch time
    if (assignment.status === 'dispatched' || assignment.status === 'pending') {
      await systemQuery(
        'UPDATE work_assignments SET status = $1, started_at = $2 WHERE id = $3',
        ['in_progress', new Date().toISOString(), assignment.id],
      );
    }

    // Build execution message with full context embedded
    let execMessage = `EXECUTE ASSIGNMENT: ${assignment.title ?? assignment.task_description}\n`;
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

    return {
      shouldRun: true,
      contextTier: 'task',
      task: 'work_loop',
      reason: `active_assignments:${activeAssignments.length}`,
      priority: 2,
      message: execMessage,
    };
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
  // Only roles explicitly listed in PROACTIVE_COOLDOWNS are eligible.
  // Sub-team agents are excluded during stabilization — they should
  // be purely reactive, working only on assigned tasks.
  const cooldownMs = PROACTIVE_COOLDOWNS[agentRole];
  if (cooldownMs != null) {
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

/** Role-specific proactive work prompts */
const PROACTIVE_PROMPTS: Record<string, string> = {
  'chief-of-staff': 'Proactive check: Review directive progress, check for stale assignments, identify cross-department patterns, prepare context for the next briefing.',
  'cto': 'Proactive check: Review platform health trends, scan for performance regressions, check open tech debt items, assess dependency freshness.',
  'cfo': 'Proactive check: Monitor cost trends, update forecasts, check margin drift, reconcile recent billing data.',
  'cpo': 'Proactive check: Analyze usage patterns, review product metrics, update competitive landscape notes, refine roadmap priorities.',
  'cmo': 'Proactive check: Draft content ideas, check SEO rankings, plan upcoming campaigns, analyze engagement metrics.',
  'vp-customer-success': 'Proactive check: Score customer health, identify churn risks, check onboarding funnel, review recent support tickets.',
  'vp-sales': 'Proactive check: Research prospects, update pipeline, prepare outreach, analyze win/loss patterns.',
  'vp-design': 'Proactive check: Audit design quality, check Lighthouse scores, review component consistency, test templates.',
  'ops': 'Proactive check: Full system health scan, data freshness check, cost anomaly detection, agent health audit.',
};

const DEFAULT_PROACTIVE_PROMPT = 'Proactive check: Execute any pending tasks from your manager, deepen expertise in your specialty area, contribute insights to the knowledge graph.';

function buildProactivePrompt(agentRole: string): string {
  return PROACTIVE_PROMPTS[agentRole] ?? DEFAULT_PROACTIVE_PROMPT;
}
