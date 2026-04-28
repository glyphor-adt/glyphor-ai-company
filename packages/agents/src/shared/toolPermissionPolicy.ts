/**
 * Tool permission gating policy.
 *
 * Default stance: tool grants/requests are self-service.
 * Approval is required only for:
 * 1) paid/spend-impacting capabilities, or
 * 2) tenant-admin / IAM / secret / tenant-level permissioning capabilities.
 */

export interface ToolPermissionDecision {
  requiresApproval: boolean;
  reason: 'paid' | 'tenant-admin' | 'paid+tenant-admin' | 'none';
  matches: string[];
}

const PAID_RISK_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'paid', pattern: /\bpaid\b/i },
  { label: 'billing', pattern: /\bbilling\b/i },
  { label: 'subscription', pattern: /\bsubscription\b/i },
  { label: 'license-cost', pattern: /\blicense\b|\blicensing\b/i },
  { label: 'invoice', pattern: /\binvoice\b/i },
  { label: 'charge', pattern: /\bcharge\b|\bcharged\b/i },
  { label: 'purchase', pattern: /\bpurchase\b|\bbuy\b|\bprocure\b/i },
  { label: 'spend', pattern: /\bcost\b|\bspend\b|\bbudget\b|\$\s*\d+/i },
];

const TENANT_ADMIN_RISK_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'tenant-admin', pattern: /\bglobal\s*admin\b|\btenant\s*admin\b|\bsuper\s*admin\b/i },
  { label: 'iam-rbac', pattern: /\biam\b|\brbac\b|\bdirectory\s*role\b|\bgrant\s+.*\brole\b|\brevoke\s+.*\brole\b/i },
  { label: 'secret-manager', pattern: /\bsecret\s*manager\b|\bsecret\s*access\b|\bupdate\s*secret\b|\brotate\s*secret\b/i },
  { label: 'credential-rotation', pattern: /\bcredential\b|\bclient\s*secret\b|\bcertificate\b|\bapp\s*registration\b/i },
  { label: 'identity-admin', pattern: /\bentra\b|\bazure\s*ad\b|\bidentity\b|\boauth\b/i },
  { label: 'service-account', pattern: /\bservice\s*account\b/i },
  { label: 'license-assignment', pattern: /\bassign\s*license\b|\brevoke\s*license\b|\bm365\s*license\b/i },
  { label: 'permissioning', pattern: /\bpermission\b|\bprivilege\b|\bleast\s*privilege\b/i },
];

function collectMatches(source: string, patterns: Array<{ label: string; pattern: RegExp }>): string[] {
  const matches: string[] = [];
  for (const entry of patterns) {
    if (entry.pattern.test(source)) {
      matches.push(entry.label);
    }
  }
  return matches;
}

export function evaluateToolPermissionGate(input: {
  toolName: string;
  contextText?: string[];
}): ToolPermissionDecision {
  const source = [input.toolName, ...(input.contextText ?? [])]
    .join('\n')
    .toLowerCase();

  const paidMatches = collectMatches(source, PAID_RISK_PATTERNS);
  const adminMatches = collectMatches(source, TENANT_ADMIN_RISK_PATTERNS);

  const paidRisk = paidMatches.length > 0;
  const adminRisk = adminMatches.length > 0;

  if (paidRisk && adminRisk) {
    return {
      requiresApproval: true,
      reason: 'paid+tenant-admin',
      matches: [...paidMatches, ...adminMatches],
    };
  }

  if (paidRisk) {
    return {
      requiresApproval: true,
      reason: 'paid',
      matches: paidMatches,
    };
  }

  if (adminRisk) {
    return {
      requiresApproval: true,
      reason: 'tenant-admin',
      matches: adminMatches,
    };
  }

  return {
    requiresApproval: false,
    reason: 'none',
    matches: [],
  };
}
