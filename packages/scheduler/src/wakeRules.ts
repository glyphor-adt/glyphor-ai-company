/**
 * Wake Rules — Declarative event-to-agent wake mappings
 *
 * Defines which agents should wake when specific events occur.
 * Used by WakeRouter to dispatch reactive agent runs.
 */

import type { CompanyAgentRole } from '@glyphor/agent-runtime';

export interface WakeRule {
  /** Event type to match (e.g., 'stripe.customer.subscription.created') */
  event: string;
  /** Optional condition expression to evaluate against event data */
  condition?: string;
  /** Agent roles to wake. Use $-prefixed tokens for dynamic resolution. */
  wake: (CompanyAgentRole | string)[];
  /** Task name to pass to the agent executor */
  task: string;
  /** Whether to wake immediately or queue for next heartbeat */
  priority: 'immediate' | 'next_heartbeat';
  /** Minimum minutes between repeat wakes for the same agent+event */
  cooldown_min?: number;
}

export const WAKE_RULES: WakeRule[] = [

  // ── FOUNDER MESSAGES (always immediate) ──────────────────────
  {
    event: 'teams_bot_dm',
    condition: 'is_founder',
    wake: ['$target_agent'],
    task: 'founder_request',
    priority: 'immediate',
  },

  // ── DASHBOARD CHAT (always immediate) ────────────────────────
  {
    event: 'dashboard_on_demand',
    wake: ['$target_agent'],
    task: 'on_demand',
    priority: 'immediate',
  },

  // ── STRIPE WEBHOOKS ──────────────────────────────────────────
  {
    event: 'customer.subscription.created',
    wake: ['vp-customer-success', 'vp-sales'],
    task: 'new_customer_welcome',
    priority: 'immediate',
    cooldown_min: 5,
  },
  {
    event: 'customer.subscription.deleted',
    wake: ['vp-customer-success', 'cfo'],
    task: 'churn_response',
    priority: 'immediate',
    cooldown_min: 5,
  },
  {
    event: 'invoice.payment_failed',
    wake: ['cfo', 'vp-customer-success'],
    task: 'payment_failure_response',
    priority: 'immediate',
    cooldown_min: 15,
  },

  // ── URGENT AGENT DMs ────────────────────────────────────────
  {
    event: 'agent_message',
    condition: 'priority_urgent',
    wake: ['$to_agent'],
    task: 'urgent_message_response',
    priority: 'immediate',
    cooldown_min: 5,
  },

  // ── ALERTS ──────────────────────────────────────────────────
  {
    event: 'alert.triggered',
    condition: 'severity_critical',
    wake: ['cto', 'ops', 'chief-of-staff'],
    task: 'incident_response',
    priority: 'immediate',
  },
  {
    event: 'alert.triggered',
    condition: 'severity_warning_cost',
    wake: ['cfo'],
    task: 'cost_alert_response',
    priority: 'next_heartbeat',
    cooldown_min: 30,
  },

  // ── DECISIONS ───────────────────────────────────────────────
  {
    event: 'decision.resolved',
    wake: ['$proposed_by'],
    task: 'decision_follow_up',
    priority: 'immediate',
    cooldown_min: 5,
  },

  // ── PLATFORM HEALTH ─────────────────────────────────────────
  {
    event: 'health_check_failure',
    wake: ['cto', 'ops'],
    task: 'incident_response',
    priority: 'immediate',
  },

  // ── MEETING COMPLETION ──────────────────────────────────────
  {
    event: 'meeting.completed',
    wake: ['$action_item_owners'],
    task: 'meeting_follow_up',
    priority: 'next_heartbeat',
  },
  // ── ASSIGNMENT LIFECYCLE (24/7 Autonomous Ops) ──────────
  {
    event: 'assignment.submitted',
    wake: ['chief-of-staff'],
    task: 'orchestrate',
    priority: 'immediate',
    cooldown_min: 5,
  },
  {
    event: 'assignment.blocked',
    wake: ['chief-of-staff'],
    task: 'orchestrate',
    priority: 'immediate',
    cooldown_min: 2,
  },
  {
    event: 'assignment.revised',
    wake: ['$target_agent'],
    task: 'work_loop',
    priority: 'immediate',
    cooldown_min: 2,
  },

  // ── INTER-AGENT MESSAGES (non-urgent — next heartbeat) ──
  {
    event: 'message.sent',
    wake: ['$to_agent'],
    task: 'work_loop',
    priority: 'next_heartbeat',
    cooldown_min: 5,
  },];
