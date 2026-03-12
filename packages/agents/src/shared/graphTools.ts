/**
 * Shared Knowledge Graph Tools — Available to all agents
 *
 * Provides trace_causes, trace_impact, query_knowledge_graph, and
 * add_knowledge tools that interact with the organizational knowledge graph.
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import type { KnowledgeGraphReader } from '@glyphor/company-memory';
import type { KnowledgeGraphWriter } from '@glyphor/company-memory';

const ROLE_DEPARTMENT: Record<string, string> = {
  'chief-of-staff': 'operations',
  'cto': 'engineering',
  'cfo': 'finance',
  'cpo': 'product',
  'cmo': 'marketing',
  'vp-customer-success': 'customer-success',
  'vp-sales': 'sales',
  'vp-design': 'design',
  'platform-engineer': 'engineering',
  'quality-engineer': 'engineering',
  'devops-engineer': 'engineering',
  'user-researcher': 'product',
  'competitive-intel': 'product',
  'revenue-analyst': 'finance',
  'cost-analyst': 'finance',
  'content-creator': 'marketing',
  'seo-analyst': 'marketing',
  'social-media-manager': 'marketing',
  'onboarding-specialist': 'customer-success',
  'support-triage': 'customer-success',
  'account-research': 'sales',
  'm365-admin': 'engineering',
  'ui-ux-designer': 'design',
  'frontend-engineer': 'design',
  'design-critic': 'design',
  'template-architect': 'design',
  'ops': 'operations',
  'vp-research': 'research',
  'competitive-research-analyst': 'research',
  'market-research-analyst': 'research',
  'technical-research-analyst': 'research',
  'industry-research-analyst': 'research',
};

export function createGraphTools(
  reader: KnowledgeGraphReader,
  writer: KnowledgeGraphWriter,
): ToolDefinition[] {
  return [
    {
      name: 'trace_causes',
      description:
        'Find out what caused something. Walk backward through the knowledge graph ' +
        'to find causal chains. Use when you need to understand WHY something happened.',
      parameters: {
        event: {
          type: 'string',
          description: 'What happened (e.g., "cost spike", "latency increase")',
          required: true,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const result = await reader.traceCauses(params.event as string, ctx.agentRole);
        return { success: true, data: result };
      },
    },

    {
      name: 'trace_impact',
      description:
        'Find out what impact something had. Walk forward through the knowledge graph ' +
        'to find downstream effects. Use when you need to understand WHAT HAPPENED BECAUSE OF something.',
      parameters: {
        event: {
          type: 'string',
          description: 'The event or action to trace impact from',
          required: true,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const result = await reader.traceImpact(params.event as string, ctx.agentRole);
        return { success: true, data: result };
      },
    },

    {
      name: 'query_knowledge_graph',
      description:
        'Search the organizational knowledge graph for connected information. ' +
        'Returns relevant facts plus their connections to other knowledge.',
      parameters: {
        query: {
          type: 'string',
          description: 'What you want to know about',
          required: true,
        },
        depth: {
          type: 'number',
          description: 'How many hops to expand (1-3, default 1)',
          required: false,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const depth = Math.min(3, Math.max(0, (params.depth as number) ?? 1));
        const context = await reader.getRelevantContext(
          params.query as string,
          ctx.agentRole,
          { limit: 10, expandHops: depth },
        );
        return {
          success: true,
          data: {
            narrative: context.narrative,
            nodeCount: context.nodes.length,
          },
        };
      },
    },

    {
      name: 'add_knowledge',
      description:
        'Add a new piece of knowledge to the graph and connect it to existing knowledge. ' +
        'Use when you discover something important that the organization should remember.',
      parameters: {
        node_type: {
          type: 'string',
          description: 'What kind of knowledge this is',
          required: true,
          enum: ['event', 'fact', 'observation', 'pattern', 'metric', 'risk', 'hypothesis'],
        },
        title: {
          type: 'string',
          description: 'Short title (5-10 words)',
          required: true,
        },
        content: {
          type: 'string',
          description: 'Full description',
          required: true,
        },
        tags: {
          type: 'array',
          description: 'Tags for categorization',
          required: false,
          items: { type: 'string', description: 'Tag' },
        },
        connects_to: {
          type: 'array',
          description: 'Connections to existing knowledge nodes',
          required: false,
          items: {
            type: 'object',
            description: 'Connection to another node',
            properties: {
              target_title: {
                type: 'string',
                description: 'Title of the node to connect to',
              },
              relationship: {
                type: 'string',
                description: 'Relationship type',
                enum: ['caused', 'contributed_to', 'supports', 'contradicts', 'affects', 'related_to'],
              },
              strength: {
                type: 'number',
                description: '0.0 to 1.0',
              },
            },
          },
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const department = ROLE_DEPARTMENT[ctx.agentRole] ?? null;

        const nodeId = await writer.createNode(ctx.agentRole, {
          node_type: params.node_type as string,
          title: params.title as string,
          content: params.content as string,
          tags: (params.tags as string[]) ?? [],
          department,
        });

        if (!nodeId) {
          return { success: false, error: 'Failed to create knowledge node' };
        }

        // Create edges to connected nodes
        let edgesCreated = 0;
        const connections = (params.connects_to as { target_title: string; relationship: string; strength?: number }[]) ?? [];
        for (const conn of connections) {
            const target = await reader.findNodeByTitle(conn.target_title, ctx.agentRole);
          if (target) {
            const ok = await writer.createEdge(
              ctx.agentRole,
              nodeId,
              target.id,
              conn.relationship,
              conn.strength ?? 0.7,
            );
            if (ok) edgesCreated++;
          }
        }

        return {
          success: true,
          data: { nodeId, edgesCreated },
          memoryKeysWritten: 1,
        };
      },
    },
  ];
}
