import { describe, expect, it, beforeEach, vi, type Mock } from 'vitest';
import {
  getHaltStatus,
  shouldBlockToolCall,
  shouldBlockHeartbeat,
  tripCircuitBreaker,
  clearCircuitBreaker,
  checkFleetCostCeiling,
  invalidateHaltCache,
  HALT_LEVEL_NAMES,
  type HaltStatus,
  type TripOptions,
} from '../circuitBreaker.js';

// ─── Mock systemQuery ────────────────────────────────────────────

const mockSystemQuery = vi.fn();

vi.mock('@glyphor/shared/db', () => ({
  systemQuery: (...args: unknown[]) => mockSystemQuery(...args),
}));

// ─── Helpers ─────────────────────────────────────────────────────

type ConfigMap = Record<string, string>;

/** Build system_config rows from a key-value map. */
function configRows(cfg: ConfigMap) {
  return Object.entries(cfg).map(([key, value]) => ({ key, value }));
}

/** Default system_config values representing an active halt. */
function haltedConfig(overrides: Partial<ConfigMap> = {}): ConfigMap {
  return {
    circuit_breaker_halt_active: 'true',
    circuit_breaker_halt_level: '2',
    circuit_breaker_halt_reason: 'Cost spike',
    circuit_breaker_halt_triggered_by: 'ops',
    circuit_breaker_halt_triggered_at: new Date().toISOString(),
    circuit_breaker_halt_expires_at: '',
    circuit_breaker_halt_fleet_cost: '12.50',
    circuit_breaker_halt_affected_agents: '[]',
    ...overrides,
  };
}

/** Default system_config values representing no halt. */
function notHaltedConfig(): ConfigMap {
  return {
    circuit_breaker_halt_active: 'false',
  };
}

// ─── Reset state between tests ──────────────────────────────────

beforeEach(() => {
  mockSystemQuery.mockReset();
  invalidateHaltCache();
});

// ═════════════════════════════════════════════════════════════════
// getHaltStatus
// ═════════════════════════════════════════════════════════════════

describe('getHaltStatus()', () => {
  it('returns NOT halted when DB says halt_active is false', async () => {
    mockSystemQuery.mockResolvedValueOnce(configRows(notHaltedConfig()));

    const status = await getHaltStatus();
    expect(status.halted).toBe(false);
    expect(status.level).toBeNull();
    expect(status.message).toBe('');
  });

  it('returns halted with correct fields when active', async () => {
    const cfg = haltedConfig();
    mockSystemQuery.mockResolvedValueOnce(configRows(cfg));

    const status = await getHaltStatus();
    expect(status.halted).toBe(true);
    expect(status.level).toBe(2);
    expect(status.reason).toBe('Cost spike');
    expect(status.triggeredBy).toBe('ops');
    expect(status.message).toContain('HALT');
    expect(status.message).toContain('Cost spike');
  });

  it('returns NOT halted when no rows exist', async () => {
    mockSystemQuery.mockResolvedValueOnce([]);

    const status = await getHaltStatus();
    expect(status.halted).toBe(false);
  });

  it('caches result within TTL', async () => {
    mockSystemQuery.mockResolvedValueOnce(configRows(notHaltedConfig()));

    const first = await getHaltStatus();
    const second = await getHaltStatus();

    // Only one DB call (cached on second)
    expect(mockSystemQuery).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
  });

  it('fails open on DB error (returns not halted)', async () => {
    mockSystemQuery.mockRejectedValueOnce(new Error('connection refused'));

    const status = await getHaltStatus();
    expect(status.halted).toBe(false);
  });

  it('auto-expires when expiresAt is in the past', async () => {
    const cfg = haltedConfig({
      circuit_breaker_halt_expires_at: new Date(Date.now() - 60_000).toISOString(),
    });
    // First call: SELECT returns active halt with past expiry
    mockSystemQuery.mockResolvedValueOnce(configRows(cfg));
    // Second call: upsertConfig sets halt_active = false
    mockSystemQuery.mockResolvedValueOnce([]);
    // Third call: persistHaltEvent audit log
    mockSystemQuery.mockResolvedValueOnce([]);

    const status = await getHaltStatus();
    expect(status.halted).toBe(false);
  });

  it('parses affected agents JSON correctly', async () => {
    const cfg = haltedConfig({
      circuit_breaker_halt_affected_agents: '["cto","ops"]',
    });
    mockSystemQuery.mockResolvedValueOnce(configRows(cfg));

    const status = await getHaltStatus();
    expect(status.affectedAgents).toEqual(['cto', 'ops']);
  });
});

// ═════════════════════════════════════════════════════════════════
// shouldBlockToolCall
// ═════════════════════════════════════════════════════════════════

describe('shouldBlockToolCall()', () => {
  it('does not block when fleet is not halted', async () => {
    mockSystemQuery.mockResolvedValueOnce(configRows(notHaltedConfig()));

    const result = await shouldBlockToolCall('save_file', 'platform-engineer');
    expect(result.blocked).toBe(false);
  });

  it('blocks write tools at Level 1 (CAUTION)', async () => {
    mockSystemQuery.mockResolvedValueOnce(configRows(haltedConfig({
      circuit_breaker_halt_level: '1',
    })));

    const result = await shouldBlockToolCall('save_file', 'platform-engineer');
    expect(result.blocked).toBe(true);
    expect(result.message).toContain('CAUTION');
  });

  it('allows read-only tools at Level 1', async () => {
    mockSystemQuery.mockResolvedValueOnce(configRows(haltedConfig({
      circuit_breaker_halt_level: '1',
    })));

    const result = await shouldBlockToolCall('query_agent_runs', 'ops');
    expect(result.blocked).toBe(false);
  });

  it('blocks ALL tools at Level 2', async () => {
    mockSystemQuery.mockResolvedValueOnce(configRows(haltedConfig({
      circuit_breaker_halt_level: '2',
    })));

    const result = await shouldBlockToolCall('query_agent_runs', 'ops');
    expect(result.blocked).toBe(true);
  });

  it('blocks ALL tools at Level 3', async () => {
    mockSystemQuery.mockResolvedValueOnce(configRows(haltedConfig({
      circuit_breaker_halt_level: '3',
    })));

    const result = await shouldBlockToolCall('read_file', 'cto');
    expect(result.blocked).toBe(true);
  });

  it('does not block agents not in affectedAgents list', async () => {
    mockSystemQuery.mockResolvedValueOnce(configRows(haltedConfig({
      circuit_breaker_halt_level: '2',
      circuit_breaker_halt_affected_agents: '["platform-engineer"]',
    })));

    const result = await shouldBlockToolCall('save_file', 'cto');
    expect(result.blocked).toBe(false);
  });

  it('blocks agents in the affectedAgents list', async () => {
    mockSystemQuery.mockResolvedValueOnce(configRows(haltedConfig({
      circuit_breaker_halt_level: '2',
      circuit_breaker_halt_affected_agents: '["platform-engineer"]',
    })));

    const result = await shouldBlockToolCall('save_file', 'platform-engineer');
    expect(result.blocked).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════
// shouldBlockHeartbeat
// ═════════════════════════════════════════════════════════════════

describe('shouldBlockHeartbeat()', () => {
  it('returns false when fleet is not halted', async () => {
    mockSystemQuery.mockResolvedValueOnce(configRows(notHaltedConfig()));

    const result = await shouldBlockHeartbeat('cto');
    expect(result.blocked).toBe(false);
  });

  it('blocks all heartbeat dispatches when halted', async () => {
    mockSystemQuery.mockResolvedValueOnce(configRows(haltedConfig()));

    const result = await shouldBlockHeartbeat('cto');
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain('CIRCUIT BREAKER');
    expect(result.reason).toContain('HALT');
  });

  it('does not block unaffected agents', async () => {
    mockSystemQuery.mockResolvedValueOnce(configRows(haltedConfig({
      circuit_breaker_halt_affected_agents: '["platform-engineer"]',
    })));

    const result = await shouldBlockHeartbeat('ops');
    expect(result.blocked).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════
// tripCircuitBreaker
// ═════════════════════════════════════════════════════════════════

describe('tripCircuitBreaker()', () => {
  it('writes all config keys and returns halt status', async () => {
    // 8 upsertConfig calls + 1 persistHaltEvent + 1 getHaltStatus SELECT
    mockSystemQuery.mockResolvedValue([]);
    // Final getHaltStatus call returns the newly set config
    const calledCfg = haltedConfig();
    let callCount = 0;
    mockSystemQuery.mockImplementation(async (sql: string) => {
      callCount++;
      // The last call is the SELECT for getHaltStatus
      if (sql.includes('SELECT') && sql.includes('system_config')) {
        return configRows(calledCfg);
      }
      return [];
    });

    const status = await tripCircuitBreaker({
      level: 2,
      reason: 'Cost spike detected in fleet',
      triggeredBy: 'ops',
    });

    expect(status.halted).toBe(true);
    expect(status.level).toBe(2);
    // At least 8 upserts + 1 audit + 1 SELECT = 10 DB calls
    expect(callCount).toBeGreaterThanOrEqual(10);
  });

  it('sets expiration when durationHours is provided', async () => {
    let capturedExpiry = '';
    mockSystemQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('INSERT INTO system_config') && params) {
        const key = (params as string[])[0];
        if (key === 'circuit_breaker_halt_expires_at') {
          capturedExpiry = (params as string[])[1];
        }
      }
      if (sql.includes('SELECT') && sql.includes('system_config')) {
        return configRows(haltedConfig({
          circuit_breaker_halt_expires_at: capturedExpiry,
        }));
      }
      return [];
    });

    await tripCircuitBreaker({
      level: 1,
      reason: 'Testing expiry behavior',
      triggeredBy: 'ops',
      durationHours: 2,
    });

    expect(capturedExpiry).not.toBe('');
    const expiry = new Date(capturedExpiry);
    // Should be ~2 hours from now (within 10 seconds tolerance)
    const diff = expiry.getTime() - Date.now();
    expect(diff).toBeGreaterThan(7190_000); // ~1h 59m 50s
    expect(diff).toBeLessThan(7210_000);    // ~2h 0m 10s
  });
});

// ═════════════════════════════════════════════════════════════════
// clearCircuitBreaker
// ═════════════════════════════════════════════════════════════════

describe('clearCircuitBreaker()', () => {
  it('returns cleared=false if not currently halted', async () => {
    mockSystemQuery.mockResolvedValueOnce(configRows(notHaltedConfig()));

    const result = await clearCircuitBreaker('kristina', 'All clear');
    expect(result.cleared).toBe(false);
    expect(result.previousLevel).toBeNull();
  });

  it('clears an active halt and returns previous level', async () => {
    // fetchHaltStatusFromDb returns active halt
    mockSystemQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT') && sql.includes('system_config')) {
        return configRows(haltedConfig());
      }
      return [];
    });

    const result = await clearCircuitBreaker('kristina', 'Reviewed cost and approved');
    expect(result.cleared).toBe(true);
    expect(result.previousLevel).toBe(2);
    expect(result.durationSeconds).toBeTypeOf('number');
  });
});

// ═════════════════════════════════════════════════════════════════
// checkFleetCostCeiling
// ═════════════════════════════════════════════════════════════════

describe('checkFleetCostCeiling()', () => {
  it('returns null when not halted and under ceiling', async () => {
    // getHaltStatus → not halted
    mockSystemQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('system_config') && sql.includes('ANY')) {
        return configRows(notHaltedConfig());
      }
      // getFleetDailyCeiling
      if (sql.includes('circuit_breaker_fleet_daily_ceiling_usd')) {
        return [{ value: '50.00' }];
      }
      // getFleetDailyCost
      if (sql.includes('SUM(total_cost_usd)')) {
        return [{ total: '10.00' }];
      }
      return [];
    });

    const result = await checkFleetCostCeiling();
    expect(result).toBeNull();
  });

  it('returns null when no ceiling is configured', async () => {
    mockSystemQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('system_config') && sql.includes('ANY')) {
        return configRows(notHaltedConfig());
      }
      if (sql.includes('circuit_breaker_fleet_daily_ceiling_usd')) {
        return []; // No ceiling set
      }
      return [];
    });

    const result = await checkFleetCostCeiling();
    expect(result).toBeNull();
  });

  it('returns null when already halted (no re-trip)', async () => {
    mockSystemQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('system_config') && sql.includes('ANY')) {
        return configRows(haltedConfig());
      }
      return [];
    });

    const result = await checkFleetCostCeiling();
    expect(result).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════
// HALT_LEVEL_NAMES
// ═════════════════════════════════════════════════════════════════

describe('HALT_LEVEL_NAMES', () => {
  it('maps all three levels', () => {
    expect(HALT_LEVEL_NAMES[1]).toBe('CAUTION');
    expect(HALT_LEVEL_NAMES[2]).toBe('HALT');
    expect(HALT_LEVEL_NAMES[3]).toBe('EMERGENCY');
  });
});
