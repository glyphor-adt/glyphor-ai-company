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

  it('prioritizes CMO Agent365 SharePoint/Copilot tools when capped', () => {
    const filler: ToolDeclaration[] = Array.from({ length: 140 }, (_, i) => ({
      name: `tool_${i}`,
      description: `filler ${i}`,
      parameters: { type: 'object', properties: {} },
    }));

    const odspTool: ToolDeclaration = {
      name: 'findFileOrFolder',
      description: '[Agent365 mcp_ODSPRemoteServer] Find file or folder in SharePoint/OneDrive.',
      parameters: { type: 'object', properties: {} },
    };

    const copilotTool: ToolDeclaration = {
      name: 'copilot_chat',
      description: '[Agent365 mcp_M365Copilot] Search organizational content with Copilot.',
      parameters: { type: 'object', properties: {} },
    };

    const filtered = filterToolDeclarations([...filler, odspTool, copilotTool], null, 'cmo');
    const names = new Set(filtered.map((tool) => tool.name));

    expect(filtered.length).toBe(128);
    expect(names.has('findFileOrFolder')).toBe(true);
    expect(names.has('copilot_chat')).toBe(true);
  });
});
