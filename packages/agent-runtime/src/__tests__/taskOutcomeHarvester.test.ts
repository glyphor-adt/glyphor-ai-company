import { describe, expect, it, vi } from 'vitest';

vi.mock('@glyphor/shared/db', () => ({
  systemQuery: vi.fn(),
}));

import { computePerRunQualityScore } from '../taskOutcomeHarvester.js';

describe('computePerRunQualityScore', () => {
  it('returns 3.5 for a clean submitted run with no tool failures', () => {
    const { score } = computePerRunQualityScore({
      final_status: 'submitted',
      turn_count: 4,
      tool_failure_count: 0,
      had_partial_save: false,
      cost_usd: 0.10,
    });
    // baseline 3.0 + 0.5 submitted + 0.2 no failures + 0.2 efficient submit = 3.9
    expect(score).toBe(3.9);
  });

  it('returns a lower score for an aborted run', () => {
    const { score } = computePerRunQualityScore({
      final_status: 'aborted',
      turn_count: 8,
      tool_failure_count: 0,
      had_partial_save: false,
      cost_usd: 0.05,
    });
    // baseline 3.0 - 1.0 aborted + 0.2 no failures = 2.2
    expect(score).toBe(2.2);
  });

  it('returns a lower score for a failed run', () => {
    const { score } = computePerRunQualityScore({
      final_status: 'failed',
      turn_count: 3,
      tool_failure_count: 5,
      had_partial_save: true,
      cost_usd: 0.60,
    });
    // baseline 3.0 - 1.0 failed - 0.3 high failures - 0.2 partial save - 0.1 high cost = 1.4
    expect(score).toBe(1.4);
  });

  it('penalises high turn count', () => {
    const { score } = computePerRunQualityScore({
      final_status: 'submitted',
      turn_count: 20,
      tool_failure_count: 0,
      had_partial_save: false,
      cost_usd: 0.10,
    });
    // baseline 3.0 + 0.5 submitted + 0.2 no failures - 0.2 high turns = 3.5
    // (no efficient-submit bonus because turns > 5)
    expect(score).toBe(3.5);
  });

  it('clamps the score to a minimum of 1.0', () => {
    const { score } = computePerRunQualityScore({
      final_status: 'failed',
      turn_count: 20,
      tool_failure_count: 10,
      had_partial_save: true,
      cost_usd: 1.00,
    });
    expect(score).toBeGreaterThanOrEqual(1.0);
    expect(score).toBeLessThanOrEqual(5.0);
  });

  it('returns a maximum of 5.0', () => {
    const { score } = computePerRunQualityScore({
      final_status: 'submitted',
      turn_count: 1,
      tool_failure_count: 0,
      had_partial_save: false,
      cost_usd: 0.01,
    });
    expect(score).toBeLessThanOrEqual(5.0);
  });

  it('includes signal notes in the output', () => {
    const { notes } = computePerRunQualityScore({
      final_status: 'submitted',
      turn_count: 3,
      tool_failure_count: 0,
      had_partial_save: false,
      cost_usd: 0.05,
    });
    expect(notes).toContain('submitted');
    expect(notes).toContain('no tool failures');
  });

  it('returns "baseline" notes for a neutral run', () => {
    const { notes } = computePerRunQualityScore({
      final_status: 'partial_progress',
      turn_count: 7,
      tool_failure_count: 0,
      had_partial_save: false,
      cost_usd: 0.10,
    });
    // partial_progress has no positive signal, no penalties triggered
    expect(notes).toContain('no tool failures');
  });
});
