/**
 * Slack message router — classifies inbound customer messages and dispatches
 * them to the appropriate destination.  Routing is two-tier:
 *
 *   1. Tenant-configured rules in slack_routing_rules (database, checked first)
 *   2. Keyword heuristics (fallback when no DB rules exist or match)
 *
 * If the matched rule has requires_approval=true a slack_approval row is
 * created with status='pending' so a human can approve/reject before a
 * substantive reply is sent.
 */

import { systemQuery } from '@glyphor/shared/db';

// ─── Types ───────────────────────────────────────────────────────────────────

export type RoutingDestination = 'support' | 'billing' | 'sales' | 'engineering' | 'general';

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

// ─── Keyword heuristics (fallback) ───────────────────────────────────────────

const KEYWORD_RULES: Array<{
  patterns: RegExp[];
  destination: RoutingDestination;
  intentLabel: string;
  requiresApproval: boolean;
}> = [
  {
    patterns: [/\binvoice\b/i, /\bpayment\b/i, /\bbilling\b/i, /\brefund\b/i, /\bcharge\b/i, /\bsubscription\b/i],
    destination: 'billing',
    intentLabel: 'billing_inquiry',
    requiresApproval: false,
  },
  {
    patterns: [/\bbug\b/i, /\berror\b/i, /\bcrash\b/i, /\bbroken\b/i, /\bnot working\b/i, /\bfailed?\b/i],
    destination: 'engineering',
    intentLabel: 'bug_report',
    requiresApproval: false,
  },
  {
    patterns: [/\bprice\b/i, /\bpric(ing|ed)\b/i, /\bplan\b/i, /\bupgrade\b/i, /\bdemo\b/i, /\btrial\b/i],
    destination: 'sales',
    intentLabel: 'sales_inquiry',
    requiresApproval: false,
  },
  {
    patterns: [/\burgent\b/i, /\bescalat\b/i, /\bmanager\b/i, /\bcomplaint\b/i, /\bunacceptable\b/i],
    destination: 'support',
    intentLabel: 'escalation',
    requiresApproval: true,
  },
];

const DEFAULT_DECISION: RoutingDecision = {
  destination: 'support',
  intentLabel: 'general_inquiry',
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

  // 2. Fallback keyword heuristics
  for (const rule of KEYWORD_RULES) {
    if (rule.patterns.some((re) => re.test(text))) {
      return {
        destination: rule.destination,
        intentLabel: rule.intentLabel,
        requiresApproval: rule.requiresApproval,
        matchedPattern: null,
      };
    }
  }

  return DEFAULT_DECISION;
}
