/**
 * Slack message router — Sarah-first intake router for inbound customer messages.
 * Routing is now two-tier:
 *
 *   1. Tenant-configured rules in slack_routing_rules (database, checked first)
 *   2. Sarah-first default intake when no DB rule matches
 *
 * The default path always routes to Sarah (chief-of-staff) so she can triage
 * customer requests before any team-specific follow-up happens.
 */

import { systemQuery } from '@glyphor/shared/db';

// ─── Types ───────────────────────────────────────────────────────────────────

export type RoutingDestination = 'chief-of-staff' | 'support' | 'billing' | 'sales' | 'engineering' | 'general';

export interface RoutingDecision {
  destination: RoutingDestination;
  intentLabel: string;
  requiresApproval: boolean;
  matchedPattern: string | null;
}

export interface DbRoutingRule {
  id: string;
  tenant_id: string;
  pattern: string;
  destination: string;
  intent_label: string | null;
  requires_approval: boolean;
  priority: number;
}

const DEFAULT_DECISION: RoutingDecision = {
  destination: 'chief-of-staff',
  intentLabel: 'coordinator_intake',
  requiresApproval: false,
  matchedPattern: null,
};

// ─── Router ───────────────────────────────────────────────────────────────────

export async function routeMessage(
  tenantId: string,
  text: string,
): Promise<RoutingDecision> {
  // 1. Tenant DB rules (highest priority)
  const dbRules = await systemQuery<DbRoutingRule>(
    `SELECT id, tenant_id, pattern, destination, intent_label, requires_approval, priority
     FROM slack_routing_rules
     WHERE tenant_id = $1 AND is_active = true
     ORDER BY priority ASC`,
    [tenantId],
  );

  for (const rule of dbRules) {
    try {
      const re = new RegExp(rule.pattern, 'i');
      if (re.test(text)) {
        return {
          destination: rule.destination as RoutingDestination,
          intentLabel: rule.intent_label ?? rule.destination,
          requiresApproval: rule.requires_approval,
          matchedPattern: rule.pattern,
        };
      }
    } catch {
      // Invalid regex — skip this rule
    }
  }

  // 2. Sarah-first fallback
  return DEFAULT_DECISION;
}
