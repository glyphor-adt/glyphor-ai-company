import { describe, expect, it } from 'vitest';
import { AgentSupervisor } from '../supervisor.js';

describe('AgentSupervisor defaults', () => {
  it('coerces non-finite maxStallTurns to 6 so stall abort cannot be skipped', () => {
    const sup = new AgentSupervisor({
      maxTurns: 10,
      maxStallTurns: Number.NaN,
      timeoutMs: 60_000,
    });
    expect(sup.config.maxStallTurns).toBe(6);
  });

  it('coerces non-positive timeoutMs to a safe default', () => {
    const sup = new AgentSupervisor({
      maxTurns: 10,
      maxStallTurns: 3,
      timeoutMs: 0,
    });
    expect(sup.config.timeoutMs).toBe(600_000);
  });
});
