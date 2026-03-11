import { describe, expect, it } from 'vitest';
import { filterToolDeclarations, getToolSubset } from '../toolSubsets.js';
import type { ToolDeclaration } from '../types.js';

const declarations: ToolDeclaration[] = [
  { name: 'web_search', description: 'search', parameters: { type: 'object', properties: {} } },
  { name: 'web_fetch', description: 'fetch', parameters: { type: 'object', properties: {} } },
  { name: 'save_memory', description: 'memory', parameters: { type: 'object', properties: {} } },
  { name: 'get_platform_health', description: 'health', parameters: { type: 'object', properties: {} } },
];

describe('toolSubsets', () => {
  it('returns a curated subset for mapped tasks', () => {
    const subset = getToolSubset('cmo', 'weekly_content_planning');
    expect(subset).not.toBeNull();
    expect(subset?.has('web_search')).toBe(true);
    expect(subset?.has('save_memory')).toBe(true);
  });

  it('returns null for open-ended proactive tasks', () => {
    expect(getToolSubset('cmo', 'proactive')).toBeNull();
  });

  it('filters declarations to the allowed names', () => {
    const subset = getToolSubset('cto', 'platform_health_check');
    const filtered = filterToolDeclarations(declarations, subset);
    expect(filtered.map((tool) => tool.name)).toEqual(['save_memory', 'get_platform_health']);
  });
});
