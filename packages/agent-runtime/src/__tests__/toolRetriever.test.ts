import { describe, expect, it } from 'vitest';
import type { ToolDeclaration } from '../types.js';
import { ToolRetriever } from '../routing/toolRetriever.js';

function makeTool(name: string, description: string): ToolDeclaration {
  return {
    name,
    description,
    parameters: {
      type: 'object',
      properties: {},
    },
  };
}

describe('toolRetriever', () => {
  it('keeps SharePoint pinned for marketing workflows', async () => {
    const retriever = new ToolRetriever();
    retriever.setUsageQueries({
      search_sharepoint: ['find the Q3 deck in SharePoint'],
      revenue_lookup: ['check current revenue figures'],
    });

    const tools: ToolDeclaration[] = [
      makeTool('search_sharepoint', 'Search SharePoint and document libraries.'),
      makeTool('findFileOrFolder', 'Find files in OneDrive and SharePoint.'),
      makeTool('revenue_lookup', 'Retrieve revenue metrics.'),
      ...Array.from({ length: 30 }, (_, index) =>
        makeTool(`tool_${index}`, `Generic helper ${index}`),
      ),
    ];

    const result = await retriever.retrieve(tools, {
      model: 'gpt-5-mini',
      role: 'cmo',
      department: 'marketing',
      taskContext: 'find the Q3 marketing deck in our document library',
    });

    const names = new Set(result.tools.map((tool) => tool.name));
    expect(names.has('search_sharepoint')).toBe(true);
  });

  it('respects model-aware caps for nano models', async () => {
    const retriever = new ToolRetriever();

    const tools: ToolDeclaration[] = [
      makeTool('search_sharepoint', 'Search SharePoint content.'),
      makeTool('send_agent_message', 'Send a message to another agent.'),
      ...Array.from({ length: 80 }, (_, index) =>
        makeTool(`filler_${index}`, `Filler tool ${index}`),
      ),
    ];

    const result = await retriever.retrieve(tools, {
      model: 'gpt-5-nano',
      role: 'cto',
      taskContext: 'summarize current status',
    });

    expect(result.tools.length).toBe(20);
    expect(result.trace.modelCap).toBe(20);
  });

  it('keeps grant_tool_access in CTO tool bundle when the model cap leaves no retrieval slots', async () => {
    const retriever = new ToolRetriever();
    const tools: ToolDeclaration[] = [
      makeTool('grant_tool_access', 'Grant an existing tool to another agent.'),
      ...Array.from({ length: 80 }, (_, index) =>
        makeTool(`filler_${index}`, `Filler tool ${index}`),
      ),
    ];

    const result = await retriever.retrieve(tools, {
      model: 'gpt-5-nano',
      role: 'cto',
      taskContext: 'vp-design needs vercel deployment logs tool',
    });

    const names = result.tools.map((t) => t.name);
    expect(names).toContain('grant_tool_access');
  });

  it('loads CTO grant_tool_access before universal pins when tool cap is severe', async () => {
    const retriever = new ToolRetriever();
    const tools: ToolDeclaration[] = [
      makeTool('grant_tool_access', 'Grant an existing tool to another agent.'),
      makeTool('save_memory', 'Save a memory entry.'),
      makeTool('recall_memories', 'Recall memories.'),
      makeTool('send_agent_message', 'Message another agent.'),
    ];

    const result = await retriever.retrieve(tools, {
      model: 'gpt-5-nano',
      role: 'cto',
      maxTools: 3,
      taskContext: 'unblock vp-design on Vercel',
    });

    expect(result.tools.map((t) => t.name)).toContain('grant_tool_access');
  });

  it('applies defer_loading for native tool-search capable models', async () => {
    const retriever = new ToolRetriever();

    const tools: ToolDeclaration[] = [
      makeTool('search_sharepoint', 'Search SharePoint content.'),
      makeTool('revenue_lookup', 'Fetch revenue metrics for finance reports.'),
    ];

    const result = await retriever.retrieve(tools, {
      model: 'claude-sonnet-4-6',
      role: 'cto',
      taskContext: 'get revenue numbers for this quarter',
    });

    const sharepoint = result.tools.find((tool) => tool.name === 'search_sharepoint');
    const revenue = result.tools.find((tool) => tool.name === 'revenue_lookup');

    expect(sharepoint).toBeDefined();
    expect(sharepoint?.defer_loading).toBeUndefined();
    expect(revenue).toBeDefined();
    expect(revenue?.defer_loading).toBe(true);
  });
});
