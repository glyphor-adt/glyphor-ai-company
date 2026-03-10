import { describe, expect, it } from 'vitest';
import { extractTaskFromConfigId } from '../taskIdentity.js';

describe('extractTaskFromConfigId', () => {
  it('extracts scheduled task names with a date suffix', () => {
    expect(extractTaskFromConfigId('cmo-weekly_content_planning-2026-03-10')).toBe('weekly_content_planning');
    expect(extractTaskFromConfigId('vp-design-design_audit-2026-03-10')).toBe('design_audit');
  });

  it('extracts task names when a run id includes a millisecond suffix', () => {
    expect(extractTaskFromConfigId('sophia-on_demand-2026-03-10-1741641700000')).toBe('on_demand');
  });
});
