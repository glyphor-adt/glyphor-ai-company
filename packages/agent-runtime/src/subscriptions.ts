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
  ],
  'cto': [
    'alert.triggered',
    'task.requested',
    'agent.completed',
  ],
  'cpo': [
    'insight.detected',
    'agent.completed',
  ],
  'cmo': [
    'insight.detected',
    'decision.resolved',
  ],
  'cfo': [
    'alert.triggered',
    'agent.completed',
  ],
  'vp-customer-success': [
    'insight.detected',
    'alert.triggered',
  ],
  'vp-sales': [
    'insight.detected',
    'decision.resolved',
  ],
  'vp-design': [
    'insight.detected',
    'agent.completed',
  ],
  // Sub-team members — subscribe to events relevant to their department
  'platform-engineer': ['alert.triggered'],
  'quality-engineer': ['alert.triggered'],
  'devops-engineer': ['alert.triggered'],
  'user-researcher': ['insight.detected'],
  'competitive-intel': ['insight.detected'],
  'revenue-analyst': ['alert.triggered'],
  'cost-analyst': ['alert.triggered'],
  'content-creator': ['insight.detected'],
  'seo-analyst': ['insight.detected'],
  'social-media-manager': ['insight.detected'],
  'onboarding-specialist': ['alert.triggered'],
  'support-triage': ['alert.triggered'],
  'account-research': ['insight.detected'],
  'ui-ux-designer': ['insight.detected'],
  'frontend-engineer': ['agent.completed'],
  'design-critic': ['agent.completed'],
  'template-architect': ['insight.detected'],
};

/**
 * Get all agent roles subscribed to a given event type.
 */
export function getSubscribers(eventType: GlyphorEventType): CompanyAgentRole[] {
  return (Object.entries(SUBSCRIPTIONS) as [CompanyAgentRole, GlyphorEventType[]][])
    .filter(([, types]) => types.includes(eventType))
    .map(([role]) => role);
}
