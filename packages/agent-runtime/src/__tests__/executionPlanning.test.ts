import { describe, expect, it } from 'vitest';
import { extractAcceptanceCriteriaFromMessage, parseExecutionPlan } from '../executionPlanning.js';

describe('executionPlanning', () => {
  it('extracts acceptance criteria from message section', () => {
    const message = `Build a landing page refresh.

Acceptance Criteria:
- Hero has a single clear CTA above the fold
- Lighthouse accessibility score is at least 90
1. Pricing section uses consistent tokenized spacing

Please execute this.`;

    expect(extractAcceptanceCriteriaFromMessage(message)).toEqual([
      'Hero has a single clear CTA above the fold',
      'Lighthouse accessibility score is at least 90',
      'Pricing section uses consistent tokenized spacing',
    ]);
  });

  it('parses strict json plan output', () => {
    const raw = JSON.stringify({
      objective: 'Improve conversion and accessibility',
      acceptance_criteria: [
        'Hero CTA is visually dominant',
        'Accessibility score is >= 90',
      ],
      execution_steps: ['Update hero section', 'Improve semantics'],
      verification_steps: ['Run lighthouse', 'Capture screenshot'],
    });

    expect(parseExecutionPlan(raw)).toEqual({
      objective: 'Improve conversion and accessibility',
      acceptanceCriteria: ['Hero CTA is visually dominant', 'Accessibility score is >= 90'],
      executionSteps: ['Update hero section', 'Improve semantics'],
      verificationSteps: ['Run lighthouse', 'Capture screenshot'],
    });
  });

  it('returns null when acceptance criteria are missing', () => {
    const raw = JSON.stringify({
      objective: 'Do something',
      execution_steps: ['step 1'],
    });
    expect(parseExecutionPlan(raw)).toBeNull();
  });
});
