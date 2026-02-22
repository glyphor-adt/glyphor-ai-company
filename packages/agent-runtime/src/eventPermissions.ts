/**
 * Event Emission Permissions — Enforces which agents can emit which events
 *
 * Executives can emit a broad set of events.
 * Sub-team members can only emit insight.detected and task.completed (via agent.completed).
 * Forbidden events (decision.resolved) can only come from system/founders.
 */

import type { CompanyAgentRole, GlyphorEventType, SecurityEvent } from './types.js';
import {
  EXECUTIVE_ROLES,
  SUB_TEAM_ROLES,
  EXECUTIVE_ALLOWED_EVENTS,
  SUB_TEAM_ALLOWED_EVENTS,
  FORBIDDEN_AGENT_EVENTS,
} from './types.js';

export interface EventPermissionCheck {
  allowed: boolean;
  reason?: string;
}

/**
 * Check whether an agent is permitted to emit a given event type.
 */
export function checkEventPermission(
  agentRole: CompanyAgentRole,
  eventType: GlyphorEventType,
): EventPermissionCheck {
  // Forbidden events — no agent can emit these
  if (FORBIDDEN_AGENT_EVENTS.includes(eventType)) {
    return {
      allowed: false,
      reason: `Event "${eventType}" is forbidden for all agents — only system/founders can emit`,
    };
  }

  // Sub-team members — very restricted
  if (SUB_TEAM_ROLES.includes(agentRole)) {
    if (!SUB_TEAM_ALLOWED_EVENTS.includes(eventType)) {
      return {
        allowed: false,
        reason: `Sub-team member "${agentRole}" cannot emit "${eventType}" — allowed: ${SUB_TEAM_ALLOWED_EVENTS.join(', ')}`,
      };
    }
    return { allowed: true };
  }

  // Executives — broader access
  if (EXECUTIVE_ROLES.includes(agentRole)) {
    if (!EXECUTIVE_ALLOWED_EVENTS.includes(eventType)) {
      return {
        allowed: false,
        reason: `Executive "${agentRole}" cannot emit "${eventType}"`,
      };
    }
    return { allowed: true };
  }

  // Unknown role — deny
  return {
    allowed: false,
    reason: `Unknown agent role "${agentRole}" — event emission denied`,
  };
}

/**
 * Create a security event for blocked event emissions.
 */
export function createEventSecurityLog(
  agentId: string,
  agentRole: CompanyAgentRole,
  eventType: GlyphorEventType,
  reason: string,
): SecurityEvent {
  return {
    agentId,
    agentRole,
    toolName: `emit_event:${eventType}`,
    eventType: 'EVENT_NOT_PERMITTED',
    details: { attemptedEventType: eventType, reason },
    timestamp: new Date().toISOString(),
  };
}
