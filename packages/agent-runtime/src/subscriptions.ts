/**
 * Agent Subscription Rules — Who listens to what
 *
 * Defines which GlyphorEvent types each agent subscribes to.
 * Used by the event bus to determine which agents to wake
 * when an event is emitted.
 */

import type { CompanyAgentRole, GlyphorEventType } from './types.js';

/**
 * Subscription map: agent role → event types they listen to.
 * Sarah Chen (chief-of-staff) subscribes to ALL events as the orchestrator.
 */
export const SUBSCRIPTIONS: Record<CompanyAgentRole, GlyphorEventType[]> = {
  'chief-of-staff': [
    'agent.completed',
    'insight.detected',
    'decision.filed',
    'decision.resolved',
    'alert.triggered',
    'task.requested',
    'agent.spawned',
    'agent.retired',
    'message.sent',
    'meeting.called',
    'meeting.completed',
    'initiative.proposed',
    'initiative.activated',
    'initiative.completed',
    'initiative.directive_completed',
    'deliverable.published',
  ],
  'cto': [
    'alert.triggered',
    'task.requested',
    'agent.completed',
    'message.sent',
    'meeting.completed',
  ],
  'cpo': [
    'insight.detected',
    'agent.completed',
    'message.sent',
    'meeting.completed',
  ],
  'cmo': [
    'insight.detected',
    'decision.resolved',
    'message.sent',
    'meeting.completed',
  ],
  'cfo': [
    'alert.triggered',
    'agent.completed',
    'message.sent',
    'meeting.completed',
  ],
  'clo': [
    'alert.triggered',
    'decision.filed',
    'decision.resolved',
    'message.sent',
    'meeting.completed',
  ],
  'vp-design': [
    'insight.detected',
    'agent.completed',
    'message.sent',
    'meeting.completed',
  ],
  // Sub-team members — subscribe to events relevant to their department
  'platform-engineer': ['alert.triggered', 'message.sent'],
  'quality-engineer': ['alert.triggered', 'message.sent'],
  'devops-engineer': ['alert.triggered', 'message.sent'],
  'ops': ['alert.triggered', 'message.sent', 'meeting.completed'],
  // Research & Intelligence
  'vp-research': ['task.requested', 'message.sent'],
  // Sales, Finance, Marketing, Operations specialists
  'bob-the-tax-pro': ['task.requested', 'message.sent'],
  'marketing-intelligence-analyst': ['task.requested', 'message.sent'],
  'adi-rose': ['task.requested', 'message.sent'],
};

/**
 * Get all agent roles subscribed to a given event type.
 */
export function getSubscribers(eventType: GlyphorEventType): CompanyAgentRole[] {
  return (Object.entries(SUBSCRIPTIONS) as [CompanyAgentRole, GlyphorEventType[]][])
    .filter(([, types]) => types.includes(eventType))
    .map(([role]) => role);
}
