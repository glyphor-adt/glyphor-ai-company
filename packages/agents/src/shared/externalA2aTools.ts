import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';

interface ExternalAgentCard {
  id: string;
  name: string;
  description?: string;
  department?: string | null;
  skills?: Array<{ name?: string; slug?: string; category?: string }>;
  qualityStandards?: Array<{ taskType?: string }>;
}

export function createExternalA2aTools(registryUrl?: string): ToolDefinition[] {
  return [
    {
      name: 'discover_external_agents',
      description:
        'Query an external A2A registry and return matching agent cards by name, description, department, skills, or rubric task types.',
      parameters: {
        query: {
          type: 'string',
          description: 'Search phrase to match against agent cards',
          required: true,
        },
        limit: {
          type: 'number',
          description: 'Maximum number of matching cards to return (default 10, max 25)',
          required: false,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        if (!registryUrl) {
          return {
            success: false,
            error: 'A2A_REGISTRY_URL is not configured for this agent environment.',
          };
        }

        const query = String(params.query ?? '').trim().toLowerCase();
        if (!query) {
          return {
            success: false,
            error: 'query is required.',
          };
        }

        const requestedLimit = Number(params.limit ?? 10);
        const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 25) : 10;

        const response = await fetch(`${registryUrl.replace(/\/$/, '')}/agents`, {
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) {
          return {
            success: false,
            error: `External registry returned ${response.status}.`,
          };
        }

        const cards = (await response.json()) as ExternalAgentCard[];
        const matches = cards
          .filter((card) => matchesQuery(card, query))
          .slice(0, limit)
          .map((card) => ({
            id: card.id,
            name: card.name,
            description: card.description ?? '',
            department: card.department ?? 'general',
            skills: (card.skills ?? []).map((skill) => skill.name ?? skill.slug ?? 'unknown'),
            taskTypes: (card.qualityStandards ?? []).map((rubric) => rubric.taskType ?? 'general'),
          }));

        return {
          success: true,
          data: {
            registryUrl,
            totalMatches: matches.length,
            agents: matches,
          },
        };
      },
    },
  ];
}

function matchesQuery(card: ExternalAgentCard, query: string): boolean {
  const haystack = [
    card.id,
    card.name,
    card.description ?? '',
    card.department ?? '',
    ...(card.skills ?? []).flatMap((skill) => [skill.name ?? '', skill.slug ?? '', skill.category ?? '']),
    ...(card.qualityStandards ?? []).map((rubric) => rubric.taskType ?? ''),
  ]
    .join(' ')
    .toLowerCase();

  return haystack.includes(query);
}
