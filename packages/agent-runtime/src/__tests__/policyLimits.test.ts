import { describe, expect, it, beforeEach, afterEach, vi, type Mock } from 'vitest';
import {
  PolicyLimitsCache,
  setPolicy,
  clearPolicy,
  listPolicies,
  checkToolPolicy,
  FAIL_CLOSED_POLICIES,
  KNOWN_POLICY_KEYS,
  type PolicyRule,
  type PolicyDecision,
} from '../policyLimits.js';
import type { CompanyAgentRole } from '../types.js';

// ─── Mock systemQuery ────────────────────────────────────────────

const mockSystemQuery = vi.fn();

vi.mock('@glyphor/shared/db', () => ({
  systemQuery: (...args: unknown[]) => mockSystemQuery(...args),
}));

// ─── Helpers ─────────────────────────────────────────────────────

// Use concrete role literals to satisfy the union type
const DEVOPS: CompanyAgentRole = 'devops-engineer';
const CTO: CompanyAgentRole = 'cto';
const CMO: CompanyAgentRole = 'cmo';
const FRONTEND: CompanyAgentRole = 'frontend-engineer';
const CONTENT: CompanyAgentRole = 'content-creator';

/** Build a raw DB row for agent_policy_limits. */
function policyRow(overrides: Partial<{
  policy_key: string;
  allowed: boolean;
  agent_role: string | null;
  tool_name: string | null;
  set_by: string;
  reason: string;
  expires_at: string | null;
  updated_at: string;
}> = {}) {
  return {
    policy_key: 'can_deploy',
    allowed: true,
    agent_role: null,
    tool_name: null,
    set_by: 'admin',
    reason: 'Standard deploy permission',
    expires_at: null,
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

/** Create and initialize a cache with pre-loaded rules. */
async function cacheWith(rows: ReturnType<typeof policyRow>[]): Promise<PolicyLimitsCache> {
  const cache = new PolicyLimitsCache();
  mockSystemQuery.mockResolvedValueOnce(rows);
  cache.initialize();
  await cache.waitForLoad();
  return cache;
}

/** Future timestamp for non-expired rules. */
const FUTURE = new Date(Date.now() + 86_400_000).toISOString();

/** Past timestamp for expired rules. */
const PAST = new Date(Date.now() - 86_400_000).toISOString();

// ─── Reset between tests ─────────────────────────────────────────

beforeEach(() => {
  mockSystemQuery.mockReset();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

// ═════════════════════════════════════════════════════════════════
// PolicyLimitsCache — Lifecycle
// ═════════════════════════════════════════════════════════════════

describe('PolicyLimitsCache lifecycle', () => {
  it('initialize() triggers a background refresh', async () => {
    mockSystemQuery.mockResolvedValueOnce([]);
    const cache = new PolicyLimitsCache();

    cache.initialize();
    await cache.waitForLoad();

    expect(mockSystemQuery).toHaveBeenCalledTimes(1);
    expect(mockSystemQuery.mock.calls[0][0]).toContain('agent_policy_limits');
    cache.destroy();
  });

  it('initialize() is idempotent — second call is a no-op', async () => {
    mockSystemQuery.mockResolvedValue([]);
    const cache = new PolicyLimitsCache();

    cache.initialize();
    cache.initialize(); // second call
    await cache.waitForLoad();

    // Only one DB call despite two initialize() calls
    expect(mockSystemQuery).toHaveBeenCalledTimes(1);
    cache.destroy();
  });

  it('destroy() stops background polling', async () => {
    mockSystemQuery.mockResolvedValue([]);
    const cache = new PolicyLimitsCache();
    cache.initialize();
    await cache.waitForLoad();

    cache.destroy();

    // Advance past multiple poll intervals — no new DB calls
    const callsBefore = mockSystemQuery.mock.calls.length;
    vi.advanceTimersByTime(20 * 60 * 1000); // 20 min
    expect(mockSystemQuery.mock.calls.length).toBe(callsBefore);
  });

  it('waitForLoad() returns even if initial load is slow (5s timeout)', async () => {
    // Simulate a very slow initial load
    mockSystemQuery.mockImplementation(
      () => new Promise(resolve => setTimeout(() => resolve([]), 10_000)),
    );

    const cache = new PolicyLimitsCache();
    cache.initialize();

    const start = Date.now();
    const waitPromise = cache.waitForLoad();
    vi.advanceTimersByTime(5_000);
    await waitPromise;

    // Should resolve (not hang) — verify cache still works
    const decision = cache.isPolicyAllowed('can_deploy', DEVOPS);
    expect(decision.source).toBe('default'); // No rules loaded yet
    cache.destroy();
  });

  it('survives initial load failure gracefully (warn, not throw)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockSystemQuery.mockRejectedValueOnce(new Error('relation does not exist'));

    const cache = new PolicyLimitsCache();
    cache.initialize();
    await cache.waitForLoad();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[PolicyLimits]'),
      expect.stringContaining('relation does not exist'),
    );

    // Should fall through to defaults
    const decision = cache.isPolicyAllowed('can_deploy', DEVOPS);
    expect(decision.allowed).toBe(true);
    expect(decision.source).toBe('default');

    cache.destroy();
    warnSpy.mockRestore();
  });

  it('background poller fires at the configured interval', async () => {
    mockSystemQuery.mockResolvedValue([]);
    const cache = new PolicyLimitsCache();
    cache.initialize();
    await cache.waitForLoad();

    expect(mockSystemQuery).toHaveBeenCalledTimes(1);

    // Advance past one poll interval (5 min)
    vi.advanceTimersByTime(5 * 60 * 1000 + 100);
    // Allow tick to settle
    await vi.runOnlyPendingTimersAsync();

    expect(mockSystemQuery.mock.calls.length).toBeGreaterThanOrEqual(2);
    cache.destroy();
  });
});

// ═════════════════════════════════════════════════════════════════
// isPolicyAllowed — Resolution Hierarchy
// ═════════════════════════════════════════════════════════════════

describe('isPolicyAllowed() resolution', () => {
  it('returns agent+tool specific rule when all tiers exist', async () => {
    const cache = await cacheWith([
      policyRow({ policy_key: 'can_deploy', allowed: false, agent_role: 'devops-engineer', tool_name: 'deploy_staging' }),
      policyRow({ policy_key: 'can_deploy', allowed: true, agent_role: 'devops-engineer', tool_name: null }),
      policyRow({ policy_key: 'can_deploy', allowed: true, agent_role: null, tool_name: 'deploy_staging' }),
      policyRow({ policy_key: 'can_deploy', allowed: true, agent_role: null, tool_name: null }),
    ]);

    const decision = cache.isPolicyAllowed('can_deploy', DEVOPS, 'deploy_staging');
    expect(decision.allowed).toBe(false); // Agent+tool wins
    expect(decision.matchedRule?.agentRole).toBe('devops-engineer');
    expect(decision.matchedRule?.toolName).toBe('deploy_staging');
    expect(decision.source).toBe('cache');
    cache.destroy();
  });

  it('falls back to agent-specific rule when no tool-specific match', async () => {
    const cache = await cacheWith([
      policyRow({ policy_key: 'can_deploy', allowed: false, agent_role: 'devops-engineer', tool_name: null }),
      policyRow({ policy_key: 'can_deploy', allowed: true, agent_role: null, tool_name: null }),
    ]);

    const decision = cache.isPolicyAllowed('can_deploy', DEVOPS, 'deploy_staging');
    expect(decision.allowed).toBe(false);
    expect(decision.matchedRule?.agentRole).toBe('devops-engineer');
    expect(decision.matchedRule?.toolName).toBeNull();
    cache.destroy();
  });

  it('falls back to fleet+tool rule when no agent-specific match', async () => {
    const cache = await cacheWith([
      policyRow({ policy_key: 'can_deploy', allowed: false, agent_role: null, tool_name: 'deploy_production' }),
      policyRow({ policy_key: 'can_deploy', allowed: true, agent_role: null, tool_name: null }),
    ]);

    const decision = cache.isPolicyAllowed('can_deploy', CTO, 'deploy_production');
    expect(decision.allowed).toBe(false);
    expect(decision.matchedRule?.agentRole).toBeNull();
    expect(decision.matchedRule?.toolName).toBe('deploy_production');
    cache.destroy();
  });

  it('falls back to fleet-wide rule when no specific matches', async () => {
    const cache = await cacheWith([
      policyRow({ policy_key: 'can_deploy', allowed: false, agent_role: null, tool_name: null }),
    ]);

    const decision = cache.isPolicyAllowed('can_deploy', FRONTEND, 'deploy_staging');
    expect(decision.allowed).toBe(false);
    expect(decision.matchedRule?.agentRole).toBeNull();
    expect(decision.matchedRule?.toolName).toBeNull();
    cache.destroy();
  });

  it('returns fail-open default when no rules match a non-sensitive policy', async () => {
    const cache = await cacheWith([]);

    const decision = cache.isPolicyAllowed('can_deploy', DEVOPS);
    expect(decision.allowed).toBe(true);
    expect(decision.matchedRule).toBeNull();
    expect(decision.source).toBe('default');
    cache.destroy();
  });

  it('ignores rules for a different policy key', async () => {
    const cache = await cacheWith([
      policyRow({ policy_key: 'can_send_slack', allowed: false, agent_role: null, tool_name: null }),
    ]);

    const decision = cache.isPolicyAllowed('can_deploy', DEVOPS);
    expect(decision.allowed).toBe(true); // No matching rule → default
    expect(decision.matchedRule).toBeNull();
    cache.destroy();
  });

  it('does not match tool-specific rule when no tool is provided', async () => {
    const cache = await cacheWith([
      policyRow({ policy_key: 'can_deploy', allowed: false, agent_role: 'devops-engineer', tool_name: 'deploy_staging' }),
    ]);

    // No toolName → skip tiers 1 and 3
    const decision = cache.isPolicyAllowed('can_deploy', DEVOPS);
    expect(decision.allowed).toBe(true); // Falls to default (fail-open)
    expect(decision.matchedRule).toBeNull();
    cache.destroy();
  });
});

// ═════════════════════════════════════════════════════════════════
// FAIL_CLOSED_POLICIES
// ═════════════════════════════════════════════════════════════════

describe('FAIL_CLOSED_POLICIES', () => {
  it('denies fail-closed policies when no rule exists', async () => {
    const cache = await cacheWith([]);

    for (const key of FAIL_CLOSED_POLICIES) {
      const decision = cache.isPolicyAllowed(key, DEVOPS);
      expect(decision.allowed).toBe(false);
      expect(decision.source).toBe('default');
      expect(decision.matchedRule).toBeNull();
    }
    cache.destroy();
  });

  it('allows fail-closed policy when an explicit rule permits it', async () => {
    const cache = await cacheWith([
      policyRow({ policy_key: 'can_deploy_production', allowed: true, agent_role: 'devops-engineer' }),
    ]);

    const decision = cache.isPolicyAllowed('can_deploy_production', DEVOPS);
    expect(decision.allowed).toBe(true);
    expect(decision.source).toBe('cache');
    cache.destroy();
  });

  it('contains exactly the expected security-sensitive policies', () => {
    expect(FAIL_CLOSED_POLICIES).toContain('can_deploy_production');
    expect(FAIL_CLOSED_POLICIES).toContain('can_send_external_email');
    expect(FAIL_CLOSED_POLICIES).toContain('can_post_internal_teams_channels');
    expect(FAIL_CLOSED_POLICIES).toContain('can_write_customer_teams');
    expect(FAIL_CLOSED_POLICIES).toContain('can_write_sharepoint');
    expect(FAIL_CLOSED_POLICIES).toContain('can_create_calendar_events');
    expect(FAIL_CLOSED_POLICIES).toContain('can_modify_billing');
    expect(FAIL_CLOSED_POLICIES).toContain('can_delete_data');
    expect(FAIL_CLOSED_POLICIES).toContain('can_access_secrets');
    expect(FAIL_CLOSED_POLICIES.size).toBe(9);
  });
});

// ═════════════════════════════════════════════════════════════════
// Expired Rules
// ═════════════════════════════════════════════════════════════════

describe('expired rules', () => {
  it('ignores rules whose expires_at is in the past', async () => {
    const cache = await cacheWith([
      policyRow({ policy_key: 'can_deploy', allowed: false, agent_role: null, expires_at: PAST }),
    ]);

    const decision = cache.isPolicyAllowed('can_deploy', DEVOPS);
    expect(decision.allowed).toBe(true); // Expired → falls to default
    expect(decision.matchedRule).toBeNull();
    cache.destroy();
  });

  it('respects rules whose expires_at is in the future', async () => {
    const cache = await cacheWith([
      policyRow({ policy_key: 'can_deploy', allowed: false, agent_role: null, expires_at: FUTURE }),
    ]);

    const decision = cache.isPolicyAllowed('can_deploy', DEVOPS);
    expect(decision.allowed).toBe(false);
    expect(decision.matchedRule).not.toBeNull();
    cache.destroy();
  });

  it('treats null expires_at as permanent (never expires)', async () => {
    const cache = await cacheWith([
      policyRow({ policy_key: 'can_deploy', allowed: false, agent_role: null, expires_at: null }),
    ]);

    const decision = cache.isPolicyAllowed('can_deploy', DEVOPS);
    expect(decision.allowed).toBe(false);
    cache.destroy();
  });
});

// ═════════════════════════════════════════════════════════════════
// getActivePolicies
// ═════════════════════════════════════════════════════════════════

describe('getActivePolicies()', () => {
  it('returns role-specific and fleet-wide non-expired rules', async () => {
    const cache = await cacheWith([
      policyRow({ policy_key: 'can_deploy', agent_role: 'devops-engineer', expires_at: null }),
      policyRow({ policy_key: 'can_send_slack', agent_role: null, expires_at: FUTURE }),
      policyRow({ policy_key: 'can_delete_data', agent_role: 'cto', expires_at: null }),
      policyRow({ policy_key: 'can_access_secrets', agent_role: null, expires_at: PAST }),
    ]);

    const policies = cache.getActivePolicies(DEVOPS);
    const keys = policies.map(p => p.policyKey);

    expect(keys).toContain('can_deploy');     // Agent-specific
    expect(keys).toContain('can_send_slack'); // Fleet-wide, not expired
    expect(keys).not.toContain('can_delete_data'); // Different agent
    expect(keys).not.toContain('can_access_secrets'); // Expired
    cache.destroy();
  });

  it('returns empty array when no rules match', async () => {
    const cache = await cacheWith([]);
    const policies = cache.getActivePolicies(DEVOPS);
    expect(policies).toEqual([]);
    cache.destroy();
  });
});

// ═════════════════════════════════════════════════════════════════
// getStats
// ═════════════════════════════════════════════════════════════════

describe('getStats()', () => {
  it('reports correct rule count after load', async () => {
    const cache = await cacheWith([
      policyRow({ policy_key: 'a' }),
      policyRow({ policy_key: 'b' }),
      policyRow({ policy_key: 'c' }),
    ]);

    const stats = cache.getStats();
    expect(stats.ruleCount).toBe(3);
    expect(stats.lastRefreshAt).toBeGreaterThan(0);
    expect(stats.stale).toBe(false);
    cache.destroy();
  });

  it('reports stale when cache exceeds TTL', async () => {
    const cache = await cacheWith([]);

    // Advance past 30s cache TTL
    vi.advanceTimersByTime(31_000);

    const stats = cache.getStats();
    expect(stats.stale).toBe(true);
    expect(stats.cacheAgeMs).toBeGreaterThanOrEqual(31_000);
    cache.destroy();
  });

  it('reports Infinity cacheAgeMs when never loaded', () => {
    const cache = new PolicyLimitsCache();
    // No initialize() call
    const stats = cache.getStats();
    expect(stats.cacheAgeMs).toBe(Infinity);
    expect(stats.ruleCount).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════
// checkToolPolicy
// ═════════════════════════════════════════════════════════════════

describe('checkToolPolicy()', () => {
  it('returns null for ungated tools (not in TOOL_POLICY_MAP)', async () => {
    const cache = await cacheWith([]);
    const result = checkToolPolicy(cache, 'write_file', DEVOPS);
    expect(result).toBeNull();
    cache.destroy();
  });

  it('evaluates mapped tools against the cache', async () => {
    const cache = await cacheWith([
      policyRow({ policy_key: 'can_deploy_staging', allowed: false, agent_role: null }),
    ]);

    const result = checkToolPolicy(cache, 'deploy_staging', DEVOPS);
    expect(result).not.toBeNull();
    expect(result!.allowed).toBe(false);
    expect(result!.policyKey).toBe('can_deploy_staging');
    cache.destroy();
  });

  it('maps deploy_production to can_deploy_production (fail-closed)', async () => {
    const cache = await cacheWith([]); // No rules

    const result = checkToolPolicy(cache, 'deploy_production', DEVOPS);
    expect(result).not.toBeNull();
    expect(result!.allowed).toBe(false); // Fail-closed
    expect(result!.policyKey).toBe('can_deploy_production');
    cache.destroy();
  });

  it('maps send_email to can_send_external_email', async () => {
    const cache = await cacheWith([
      policyRow({ policy_key: 'can_send_external_email', allowed: true, agent_role: 'cmo' }),
    ]);

    const result = checkToolPolicy(cache, 'send_email', CMO);
    expect(result!.allowed).toBe(true);
    cache.destroy();
  });

  it('maps post_to_customer_teams to can_write_customer_teams (fail-closed)', async () => {
    const cache = await cacheWith([]);

    const result = checkToolPolicy(cache, 'post_to_customer_teams', CMO);
    expect(result).not.toBeNull();
    expect(result!.allowed).toBe(false);
    expect(result!.policyKey).toBe('can_write_customer_teams');
    cache.destroy();
  });

  it('maps upload_to_sharepoint to can_write_sharepoint (fail-closed)', async () => {
    const cache = await cacheWith([]);

    const result = checkToolPolicy(cache, 'upload_to_sharepoint', CTO);
    expect(result).not.toBeNull();
    expect(result!.allowed).toBe(false);
    expect(result!.policyKey).toBe('can_write_sharepoint');
    cache.destroy();
  });

  it('maps create_calendar_event to can_create_calendar_events (fail-closed)', async () => {
    const cache = await cacheWith([]);

    const result = checkToolPolicy(cache, 'create_calendar_event', CMO);
    expect(result).not.toBeNull();
    expect(result!.allowed).toBe(false);
    expect(result!.policyKey).toBe('can_create_calendar_events');
    cache.destroy();
  });

  it('maps internal Teams channel tools to can_post_internal_teams_channels (fail-closed)', async () => {
    const cache = await cacheWith([]);

    const briefings = checkToolPolicy(cache, 'post_to_briefings', CTO);
    const deliverables = checkToolPolicy(cache, 'post_to_deliverables', CTO);
    const teams = checkToolPolicy(cache, 'post_to_teams', CTO);

    expect(briefings).not.toBeNull();
    expect(briefings!.allowed).toBe(false);
    expect(briefings!.policyKey).toBe('can_post_internal_teams_channels');

    expect(deliverables).not.toBeNull();
    expect(deliverables!.allowed).toBe(false);
    expect(deliverables!.policyKey).toBe('can_post_internal_teams_channels');

    expect(teams).not.toBeNull();
    expect(teams!.allowed).toBe(false);
    expect(teams!.policyKey).toBe('can_post_internal_teams_channels');

    cache.destroy();
  });

  it('maps create_pull_request to can_create_pr', async () => {
    const cache = await cacheWith([
      policyRow({ policy_key: 'can_create_pr', allowed: true, agent_role: null }),
    ]);

    const result = checkToolPolicy(cache, 'create_pull_request', FRONTEND);
    expect(result!.allowed).toBe(true);
    cache.destroy();
  });

  it('maps read_secret and write_secret to can_access_secrets (fail-closed)', async () => {
    const cache = await cacheWith([]); // No rules

    const readResult = checkToolPolicy(cache, 'read_secret', CTO);
    const writeResult = checkToolPolicy(cache, 'write_secret', CTO);

    expect(readResult!.allowed).toBe(false);
    expect(writeResult!.allowed).toBe(false);
    expect(readResult!.policyKey).toBe('can_access_secrets');
    cache.destroy();
  });
});

// ═════════════════════════════════════════════════════════════════
// setPolicy
// ═════════════════════════════════════════════════════════════════

describe('setPolicy()', () => {
  it('inserts a fleet-wide policy rule', async () => {
    mockSystemQuery.mockResolvedValueOnce([]);

    await setPolicy(null, 'can_deploy', false, 'kristina', 'Release freeze');

    expect(mockSystemQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockSystemQuery.mock.calls[0];
    expect(sql).toContain('INSERT INTO agent_policy_limits');
    expect(sql).toContain('ON CONFLICT');
    expect(params[0]).toBe('can_deploy');   // policy_key
    expect(params[1]).toBe(false);          // allowed
    expect(params[2]).toBeNull();           // agent_role (fleet-wide)
    expect(params[3]).toBeNull();           // tool_name
    expect(params[4]).toBe('kristina');     // set_by
    expect(params[5]).toBe('Release freeze'); // reason
    expect(params[6]).toBeNull();           // expires_at (permanent)
  });

  it('inserts an agent-specific policy with tool scope', async () => {
    mockSystemQuery.mockResolvedValueOnce([]);

    await setPolicy(
      DEVOPS,
      'can_deploy_staging',
      true,
      'ops-bot',
      'Granted staging deploy',
      { toolName: 'deploy_staging' },
    );

    const [, params] = mockSystemQuery.mock.calls[0];
    expect(params[0]).toBe('can_deploy_staging');
    expect(params[2]).toBe('devops-engineer');
    expect(params[3]).toBe('deploy_staging');
  });

  it('computes expires_at from expiresInHours option', async () => {
    mockSystemQuery.mockResolvedValueOnce([]);
    const before = Date.now();

    await setPolicy(null, 'can_deploy', false, 'admin', 'Temporary freeze', {
      expiresInHours: 2,
    });

    const [, params] = mockSystemQuery.mock.calls[0];
    const expiresAt = new Date(params[6] as string).getTime();
    const expectedMin = before + 2 * 3_600_000;
    const expectedMax = expectedMin + 5_000; // 5s tolerance

    expect(expiresAt).toBeGreaterThanOrEqual(expectedMin);
    expect(expiresAt).toBeLessThanOrEqual(expectedMax);
  });
});

// ═════════════════════════════════════════════════════════════════
// clearPolicy
// ═════════════════════════════════════════════════════════════════

describe('clearPolicy()', () => {
  it('returns true when a row was deleted', async () => {
    mockSystemQuery.mockResolvedValueOnce([{ id: '123' }]);

    const result = await clearPolicy(null, 'can_deploy');
    expect(result).toBe(true);

    const [sql, params] = mockSystemQuery.mock.calls[0];
    expect(sql).toContain('DELETE FROM agent_policy_limits');
    expect(params[0]).toBe('can_deploy');
    expect(params[1]).toBeNull();
    expect(params[2]).toBeNull();
  });

  it('returns false when no row matched', async () => {
    mockSystemQuery.mockResolvedValueOnce([]);

    const result = await clearPolicy(CTO, 'can_deploy', 'deploy_staging');
    expect(result).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════
// listPolicies
// ═════════════════════════════════════════════════════════════════

describe('listPolicies()', () => {
  it('returns all active policies when no filter provided', async () => {
    mockSystemQuery.mockResolvedValueOnce([
      policyRow({ policy_key: 'can_deploy' }),
      policyRow({ policy_key: 'can_send_slack' }),
    ]);

    const policies = await listPolicies();
    expect(policies).toHaveLength(2);
    expect(policies[0].policyKey).toBe('can_deploy');
    expect(policies[1].policyKey).toBe('can_send_slack');
  });

  it('filters by agentRole when provided', async () => {
    mockSystemQuery.mockResolvedValueOnce([
      policyRow({ agent_role: 'devops-engineer' }),
    ]);

    await listPolicies({ agentRole: DEVOPS });

    const [sql, params] = mockSystemQuery.mock.calls[0];
    expect(sql).toContain('agent_role = $1');
    expect(params[0]).toBe('devops-engineer');
  });

  it('filters by policyKey when provided', async () => {
    mockSystemQuery.mockResolvedValueOnce([]);

    await listPolicies({ policyKey: 'can_deploy_production' });

    const [sql, params] = mockSystemQuery.mock.calls[0];
    expect(sql).toContain('policy_key = $');
    expect(params).toContain('can_deploy_production');
  });

  it('applies both filters simultaneously', async () => {
    mockSystemQuery.mockResolvedValueOnce([]);

    await listPolicies({ agentRole: CTO, policyKey: 'can_deploy' });

    const [sql, params] = mockSystemQuery.mock.calls[0];
    expect(sql).toContain('agent_role = $1');
    expect(sql).toContain('policy_key = $2');
    expect(params).toEqual(['cto', 'can_deploy']);
  });
});

// ═════════════════════════════════════════════════════════════════
// KNOWN_POLICY_KEYS
// ═════════════════════════════════════════════════════════════════

describe('KNOWN_POLICY_KEYS', () => {
  it('contains all fail-closed policies', () => {
    for (const key of FAIL_CLOSED_POLICIES) {
      expect(KNOWN_POLICY_KEYS).toContain(key);
    }
  });

  it('has at least 16 documented policy keys', () => {
    expect(KNOWN_POLICY_KEYS.length).toBeGreaterThanOrEqual(16);
  });
});

// ═════════════════════════════════════════════════════════════════
// Edge Cases / Integration
// ═════════════════════════════════════════════════════════════════

describe('edge cases', () => {
  it('works when cache has no rules loaded (empty cache)', async () => {
    const cache = await cacheWith([]);

    // Non-sensitive → allowed
    expect(cache.isPolicyAllowed('can_deploy', DEVOPS).allowed).toBe(true);
    // Sensitive → denied
    expect(cache.isPolicyAllowed('can_deploy_production', DEVOPS).allowed).toBe(false);
    cache.destroy();
  });

  it('handles multiple rules for the same key but different agents', async () => {
    const cache = await cacheWith([
      policyRow({ policy_key: 'can_deploy', allowed: true, agent_role: 'devops-engineer' }),
      policyRow({ policy_key: 'can_deploy', allowed: false, agent_role: 'content-creator' }),
    ]);

    expect(cache.isPolicyAllowed('can_deploy', DEVOPS).allowed).toBe(true);
    expect(cache.isPolicyAllowed('can_deploy', CONTENT).allowed).toBe(false);
    cache.destroy();
  });

  it('refresh failure preserves existing cache (does not clear rules)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Load initial data
    const cache = await cacheWith([
      policyRow({ policy_key: 'can_deploy', allowed: false, agent_role: null }),
    ]);

    // Next refresh fails
    mockSystemQuery.mockRejectedValueOnce(new Error('DB down'));
    await cache.refresh();

    // Original rule should still be cached
    const decision = cache.isPolicyAllowed('can_deploy', DEVOPS);
    expect(decision.allowed).toBe(false);
    expect(decision.source).toBe('cache');

    cache.destroy();
    warnSpy.mockRestore();
  });

  it('pre-initialize reads return defaults (not throw)', () => {
    const cache = new PolicyLimitsCache();
    // No initialize()

    const decision = cache.isPolicyAllowed('can_deploy', DEVOPS);
    expect(decision.allowed).toBe(true);
    expect(decision.source).toBe('default');
  });
});
