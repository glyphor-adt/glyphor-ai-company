import { describe, expect, it } from 'vitest';
import { classifyActionRisk } from '@glyphor/shared';

describe('classifyActionRisk (shared)', () => {
  it('classifies read-style tools as AUTONOMOUS', () => {
    expect(classifyActionRisk('list_issues').level).toBe('AUTONOMOUS');
    expect(classifyActionRisk('get_user').level).toBe('AUTONOMOUS');
  });

  it('classifies external send patterns as SOFT_GATE', () => {
    expect(classifyActionRisk('send_email').level).toBe('SOFT_GATE');
    expect(classifyActionRisk('post_to_slack').level).toBe('SOFT_GATE');
  });

  it('classifies destructive or deploy tools as HARD_GATE', () => {
    expect(classifyActionRisk('delete_branch').level).toBe('HARD_GATE');
    expect(classifyActionRisk('deploy_production').level).toBe('HARD_GATE');
    expect(classifyActionRisk('merge_github_pr').level).toBe('HARD_GATE');
  });
});
