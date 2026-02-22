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
  'vp-customer-success': [
    'insight.detected',
    'alert.triggered',
    'message.sent',
    'meeting.completed',
  ],
  'vp-sales': [
    'insight.detected',
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
  'user-researcher': ['insight.detected', 'message.sent'],
  'competitive-intel': ['insight.detected', 'message.sent'],
  'revenue-analyst': ['alert.triggered', 'message.sent'],
  'cost-analyst': ['alert.triggered', 'message.sent'],
  'content-creator': ['insight.detected', 'message.sent'],
  'seo-analyst': ['insight.detected', 'message.sent'],
  'social-media-manager': ['insight.detected', 'message.sent'],
  'onboarding-specialist': ['alert.triggered', 'message.sent'],
  'support-triage': ['alert.triggered', 'message.sent'],
  'account-research': ['insight.detected', 'message.sent'],
  'ui-ux-designer': ['insight.detected', 'message.sent'],
  'frontend-engineer': ['agent.completed', 'message.sent'],
  'design-critic': ['agent.completed', 'message.sent'],
  'template-architect': ['insight.detected', 'message.sent'],
  'ops': ['alert.triggered', 'message.sent', 'meeting.completed'],
};

/**
 * Get all agent roles subscribed to a given event type.
 */
export function getSubscribers(eventType: GlyphorEventType): CompanyAgentRole[] {
  return (Object.entries(SUBSCRIPTIONS) as [CompanyAgentRole, GlyphorEventType[]][])
    .filter(([, types]) => types.includes(eventType))
    .map(([role]) => role);
}
