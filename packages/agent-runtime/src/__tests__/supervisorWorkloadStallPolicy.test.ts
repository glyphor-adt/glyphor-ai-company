import { describe, expect, it } from 'vitest';
import type { SupervisorConfig } from '../types.js';
import {
  applyWorkloadReadsProgressAndStallFloor,
  reserveSupervisorWrapUpTurnForWorkload,
} from '../supervisorWorkloadStallPolicy.js';

describe('applyWorkloadReadsProgressAndStallFloor', () => {
  it('enables readsAsProgress and floors maxStallTurns at 6 when agent config was looser', () => {
    const cfg: SupervisorConfig = {
      maxTurns: 20,
      maxStallTurns: 3,
      timeoutMs: 600_000,
      readsAsProgress: false,
    };
    applyWorkloadReadsProgressAndStallFloor(cfg);
    expect(cfg.readsAsProgress).toBe(true);
    expect(cfg.maxStallTurns).toBe(6);
  });

  it('preserves maxStallTurns when already above 6', () => {
    const cfg: SupervisorConfig = {
      maxTurns: 20,
      maxStallTurns: 10,
      timeoutMs: 600_000,
    };
    applyWorkloadReadsProgressAndStallFloor(cfg);
    expect(cfg.readsAsProgress).toBe(true);
    expect(cfg.maxStallTurns).toBe(10);
  });

  it('adds one wrap-up maxTurn for workload tasks only', () => {
    const sup = { config: { maxTurns: 40, maxStallTurns: 6, timeoutMs: 600_000 } as SupervisorConfig };
    reserveSupervisorWrapUpTurnForWorkload(sup, 'work_loop');
    expect(sup.config.maxTurns).toBe(41);
    reserveSupervisorWrapUpTurnForWorkload(sup, 'on_demand');
    expect(sup.config.maxTurns).toBe(41);
  });
});
