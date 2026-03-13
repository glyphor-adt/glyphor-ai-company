/**
 * Collective Intelligence Tools — Shared tools for organizational cognition.
 *
 * Used by Chief of Staff (Sarah) for knowledge promotion, process patterns,
 * authority proposals, and pulse management.
 * Used by Ops (Atlas) for contradiction detection and knowledge hygiene.
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import type { CompanyMemoryStore } from '@glyphor/company-memory';

export const REQUIRED_COMPANY_DOCTRINE_SECTIONS = [
  'mission',
  'current_priorities',
  'authority_model',
  'operating_doctrine',
] as const;

function getMissingDoctrineSections(
  sections: Array<{ section: string; is_active: boolean }>,
): string[] {
  const activeSections = new Set(
    sections
      .filter((section) => section.is_active)
      .map((section) => section.section),
  );

  return REQUIRED_COMPANY_DOCTRINE_SECTIONS.filter((section) => !activeSections.has(section));
}

export function createCollectiveIntelligenceTools(
  memory: CompanyMemoryStore,
): ToolDefinition[] {
  const ci = memory.getCollectiveIntelligence();

  return [
    // ─── COMPANY PULSE (Layer 1) ────────────────────────────────

    {
      name: 'get_company_pulse',
      description: 'Get the current company pulse — real-time vitals including MRR, platform status, highlights, and mood.',
      parameters: {},
      execute: async (): Promise<ToolResult> => {
        const pulse = await ci.getPulse();
        return { success: true, data: pulse };
      },
    },

    {
      name: 'update_company_pulse',
      description: 'Update specific fields of the company pulse. Only update fields you are responsible for.',
      parameters: {
        updates: {
          type: 'object',
          description: 'Key-value pairs to update on the pulse (e.g., { mrr: 3247, mrr_change_pct: 2.1 })',
          required: true,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        const updates = params.updates as Record<string, unknown> | undefined;
        if (!updates || typeof updates !== 'object' || Array.isArray(updates) || Object.keys(updates).length === 0) {
          return { success: false, error: 'updates is required and must be a non-empty object' };
        }
        await ci.updatePulse(updates);
        return { success: true, data: { updated: Object.keys(updates) } };
      },
    },

    {
      name: 'update_pulse_highlights',
      description: 'Update the company pulse top-3 highlights. Each highlight has agent, type (positive/alert/neutral), and text.',
      parameters: {
        highlights: {
          type: 'array',
          description: 'Array of up to 3 highlights',
          required: true,
          items: {
            type: 'object',
            description: 'A highlight entry',
            properties: {
              agent: { type: 'string', description: 'Agent slug who generated this' },
              type: { type: 'string', description: 'Highlight type', enum: ['positive', 'alert', 'neutral'] },
              text: { type: 'string', description: 'Short description' },
            },
          },
        },
      },
      execute: async (params): Promise<ToolResult> => {
        const inputHighlights = Array.isArray(params.highlights)
          ? (params.highlights as Array<{ agent: string; type: string; text: string }>)
          : [];
        if (inputHighlights.length === 0) {
          return { success: false, error: 'highlights is required and must be a non-empty array' };
        }

        const highlights = inputHighlights.map(h => ({
          agent: h.agent,
          type: h.type as 'positive' | 'alert' | 'neutral',
          text: h.text,
        })).slice(0, 3);
        await ci.updatePulse({ highlights });
        return { success: true, data: { highlights_count: highlights.length } };
      },
    },

    // ─── ORGANIZATIONAL KNOWLEDGE (Layer 2) ─────────────────────

    {
      name: 'promote_to_org_knowledge',
      description: 'Promote an insight to organizational knowledge. Use when an observation spans multiple departments or has cross-functional implications.',
      parameters: {
        knowledge_type: {
          type: 'string',
          description: 'Type of organizational knowledge',
          required: true,
          enum: ['cross_functional', 'causal_link', 'policy', 'constraint', 'capability', 'risk', 'opportunity'],
        },
        content: {
          type: 'string',
          description: 'The knowledge statement',
          required: true,
        },
        evidence: {
          type: 'string',
          description: 'Evidence supporting this knowledge',
          required: false,
        },
        departments_affected: {
          type: 'array',
          description: 'Departments this affects (engineering, finance, marketing, product, design, sales, research, legal, operations)',
          required: true,
          items: { type: 'string', description: 'Department name' },
        },
        agents_who_need_this: {
          type: 'array',
          description: 'Specific agent role slugs who need this knowledge',
          required: false,
          items: { type: 'string', description: 'Agent role slug' },
        },
        confidence: {
          type: 'number',
          description: 'Confidence level 0.0-1.0 (default: 0.7)',
          required: false,
        },
        tags: {
          type: 'array',
          description: 'Tags for routing and retrieval',
          required: false,
          items: { type: 'string', description: 'Tag' },
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const id = await ci.saveCompanyKnowledge({
          knowledge_type: params.knowledge_type as string,
          content: params.content as string,
          evidence: params.evidence as string | undefined,
          discovered_by: ctx.agentRole,
          departments_affected: params.departments_affected as string[],
          agents_who_need_this: params.agents_who_need_this as string[] | undefined,
          confidence: params.confidence as number | undefined,
          tags: params.tags as string[] | undefined,
        });
        return { success: true, data: { knowledge_id: id }, memoryKeysWritten: 1 };
      },
    },

    {
      name: 'get_org_knowledge',
      description: 'Retrieve active organizational knowledge, optionally filtered by agent or department.',
      parameters: {
        agent_id: {
          type: 'string',
          description: 'Filter to knowledge relevant to this agent',
          required: false,
        },
        department: {
          type: 'string',
          description: 'Filter to knowledge relevant to this department',
          required: false,
        },
        limit: {
          type: 'number',
          description: 'Max results (default: 15)',
          required: false,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        const knowledge = await ci.getCompanyKnowledge({
          agentId: params.agent_id as string | undefined,
          department: params.department as string | undefined,
          limit: params.limit as number | undefined,
        });
        return { success: true, data: knowledge };
      },
    },

    {
      name: 'read_company_doctrine',
      description: 'Read active doctrine/knowledge-base sections that define company strategy, priorities, and operating principles.',
      parameters: {
        audience: {
          type: 'string',
          description: 'Optional audience filter for doctrine sections',
          required: false,
          enum: ['all', 'executives', 'engineering', 'finance', 'product', 'marketing', 'sales', 'customer_success', 'design', 'operations'],
        },
        section_filter: {
          type: 'string',
          description: 'Optional keyword filter matching section slug, title, or content',
          required: false,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        const audience = params.audience as string | undefined;
        const sectionFilter = (params.section_filter as string | undefined)?.trim().toLowerCase();
        const sections = await ci.getKnowledgeBaseSections();
        const missingRequiredSections = getMissingDoctrineSections(sections);

        if (sections.every((section) => !section.is_active)) {
          return {
            success: false,
            error:
              'Company doctrine is empty at runtime: no active sections were found in company_knowledge_base. Apply the knowledge-base seed before running strategic planning.',
          };
        }

        if (!sectionFilter && missingRequiredSections.length > 0) {
          return {
            success: false,
            error:
              `Company doctrine is incomplete at runtime: missing required sections (${missingRequiredSections.join(', ')}). Apply the autonomy doctrine seed migration before running strategic planning.`,
          };
        }

        const filtered = sections.filter((section) => {
          if (!section.is_active) return false;
          if (audience && section.audience !== 'all' && section.audience !== audience) return false;
          if (!sectionFilter) return true;

          return (
            section.section.toLowerCase().includes(sectionFilter) ||
            section.title.toLowerCase().includes(sectionFilter) ||
            section.content.toLowerCase().includes(sectionFilter)
          );
        });

        return {
          success: true,
          data: {
            sections: filtered,
            required_sections: [...REQUIRED_COMPANY_DOCTRINE_SECTIONS],
            missing_required_sections: missingRequiredSections,
            doctrine_markdown: filtered
              .map((section) => `## ${section.title}\n\n${section.content}`)
              .join('\n\n---\n\n'),
          },
        };
      },
    },

    // ─── KNOWLEDGE ROUTING (Layer 2) ────────────────────────────

    {
      name: 'create_knowledge_route',
      description: 'Create a new knowledge routing rule. Knowledge matching these criteria will be automatically delivered to target agents.',
      parameters: {
        source_tags: {
          type: 'array',
          description: 'Tags that trigger this route',
          required: false,
          items: { type: 'string', description: 'Tag' },
        },
        source_type: {
          type: 'string',
          description: 'Knowledge type that triggers this route',
          required: false,
        },
        target_agents: {
          type: 'array',
          description: 'Agent role slugs to deliver to',
          required: true,
          items: { type: 'string', description: 'Agent role slug' },
        },
        delivery_method: {
          type: 'string',
          description: 'How to deliver: inject (silent), message (DM), alert (urgent DM)',
          required: false,
          enum: ['inject', 'message', 'alert'],
        },
        description: {
          type: 'string',
          description: 'Human-readable description of this route',
          required: true,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        const id = await ci.createRoute({
          source_tags: params.source_tags as string[] | undefined,
          source_type: params.source_type as string | undefined,
          target_agents: params.target_agents as string[],
          delivery_method: params.delivery_method as string | undefined,
          description: params.description as string,
        });
        return { success: true, data: { route_id: id }, memoryKeysWritten: 1 };
      },
    },

    {
      name: 'get_knowledge_routes',
      description: 'List all active knowledge routing rules.',
      parameters: {},
      execute: async (): Promise<ToolResult> => {
        const routes = await ci.getActiveRoutes();
        return { success: true, data: routes };
      },
    },

    // ─── CONTRADICTION DETECTION (Layer 2) ──────────────────────

    {
      name: 'detect_contradictions',
      description: 'Scan agent knowledge for potential contradictions — cases where two agents hold semantically similar but different facts.',
      parameters: {},
      execute: async (): Promise<ToolResult> => {
        const conflicts = await ci.detectContradictions();
        return { success: true, data: { conflicts, count: conflicts.length } };
      },
    },

    // ─── PROCESS PATTERNS (Layer 3) ─────────────────────────────

    {
      name: 'record_process_pattern',
      description: 'Record a discovered process pattern — a repeated workflow, bottleneck, collaboration pattern, or waste.',
      parameters: {
        pattern_type: {
          type: 'string',
          description: 'Type of pattern',
          required: true,
          enum: ['workflow', 'bottleneck', 'collaboration', 'failure_chain', 'success_chain', 'waste'],
        },
        description: {
          type: 'string',
          description: 'What the pattern is',
          required: true,
        },
        evidence: {
          type: 'string',
          description: 'Specific data/events proving this pattern',
          required: true,
        },
        impact_type: {
          type: 'string',
          description: 'What this impacts',
          required: false,
          enum: ['efficiency', 'quality', 'cost', 'speed', 'risk'],
        },
        impact_magnitude: {
          type: 'string',
          description: 'How significant',
          required: false,
          enum: ['high', 'medium', 'low'],
        },
        suggested_action: {
          type: 'string',
          description: 'What should change',
          required: false,
        },
        action_type: {
          type: 'string',
          description: 'Type of response needed',
          required: false,
          enum: ['automate', 'eliminate', 'restructure', 'monitor'],
        },
        agents_involved: {
          type: 'array',
          description: 'Agent role slugs involved in this pattern',
          required: false,
          items: { type: 'string', description: 'Agent role slug' },
        },
        departments_involved: {
          type: 'array',
          description: 'Departments involved',
          required: false,
          items: { type: 'string', description: 'Department name' },
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const id = await ci.saveProcessPattern({
          pattern_type: params.pattern_type as string,
          description: params.description as string,
          evidence: params.evidence as string,
          impact_type: params.impact_type as string | undefined,
          impact_magnitude: params.impact_magnitude as string | undefined,
          suggested_action: params.suggested_action as string | undefined,
          action_type: params.action_type as string | undefined,
          agents_involved: params.agents_involved as string[] | undefined,
          departments_involved: params.departments_involved as string[] | undefined,
          discovered_by: ctx.agentRole,
        });
        return { success: true, data: { pattern_id: id }, memoryKeysWritten: 1 };
      },
    },

    {
      name: 'get_process_patterns',
      description: 'Get discovered process patterns, optionally filtering by implementation status.',
      parameters: {
        implemented: {
          type: 'boolean',
          description: 'Filter by implementation status (true = implemented, false = pending)',
          required: false,
        },
        limit: {
          type: 'number',
          description: 'Max results (default: 20)',
          required: false,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        const patterns = await ci.getProcessPatterns({
          implemented: params.implemented as boolean | undefined,
          limit: params.limit as number | undefined,
        });
        return { success: true, data: patterns };
      },
    },

    // ─── AUTHORITY PROPOSALS (Layer 3) ──────────────────────────

    {
      name: 'propose_authority_change',
      description: 'Propose a governance change — e.g., promoting an agent\'s action from Yellow to Green tier based on evidence.',
      parameters: {
        agent_id: {
          type: 'string',
          description: 'Agent role slug',
          required: true,
        },
        current_tier: {
          type: 'string',
          description: 'Current decision tier for this action',
          required: true,
          enum: ['yellow', 'red'],
        },
        proposed_tier: {
          type: 'string',
          description: 'Proposed decision tier',
          required: true,
          enum: ['green', 'yellow'],
        },
        action: {
          type: 'string',
          description: 'What action/decision type this applies to',
          required: true,
        },
        evidence: {
          type: 'string',
          description: 'Evidence supporting the change (approval rates, outcomes, etc.)',
          required: true,
        },
        success_count: {
          type: 'number',
          description: 'Number of times approved without changes',
          required: false,
        },
        total_count: {
          type: 'number',
          description: 'Total number of times this decision was filed',
          required: false,
        },
        approval_rate: {
          type: 'number',
          description: 'Approval rate as decimal (0.0-1.0)',
          required: false,
        },
        avg_wait_hours: {
          type: 'number',
          description: 'Average hours founders spend reviewing this',
          required: false,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        const id = await ci.saveAuthorityProposal({
          agent_id: params.agent_id as string,
          current_tier: params.current_tier as string,
          proposed_tier: params.proposed_tier as string,
          action: params.action as string,
          evidence: params.evidence as string,
          success_count: params.success_count as number | undefined,
          total_count: params.total_count as number | undefined,
          approval_rate: params.approval_rate as number | undefined,
          avg_wait_hours: params.avg_wait_hours as number | undefined,
        });
        return { success: true, data: { proposal_id: id }, memoryKeysWritten: 1 };
      },
    },

    {
      name: 'get_authority_proposals',
      description: 'Get authority change proposals, optionally filtered by status.',
      parameters: {
        status: {
          type: 'string',
          description: 'Filter by status',
          required: false,
          enum: ['proposed', 'approved', 'rejected'],
        },
      },
      execute: async (params): Promise<ToolResult> => {
        const proposals = await ci.getAuthorityProposals(params.status as string | undefined);
        return { success: true, data: proposals };
      },
    },

    // ─── KNOWLEDGE BASE SECTION UPDATES ─────────────────────────

    {
      name: 'update_doctrine_section',
      description: 'Update a company knowledge base / doctrine section (e.g. metrics, current_priorities, infrastructure). Use read_company_doctrine first to get section IDs, then update the content with current data. Increments the version automatically.',
      parameters: {
        section_id: {
          type: 'string',
          description: 'UUID of the knowledge base section to update (get from read_company_doctrine)',
          required: true,
        },
        content: {
          type: 'string',
          description: 'New content for the section (replaces existing content entirely)',
          required: true,
        },
        title: {
          type: 'string',
          description: 'Optional new title for the section',
          required: false,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const sectionId = params.section_id as string;
        const content = params.content as string;
        const title = params.title as string | undefined;

        if (!sectionId || !content) {
          return { success: false, error: 'section_id and content are required' };
        }

        // Bump version
        const sections = await ci.getKnowledgeBaseSections();
        const section = sections.find((s) => s.id === sectionId);
        if (!section) {
          return { success: false, error: `Section ${sectionId} not found` };
        }

        const updates: Record<string, unknown> = {
          content,
          last_edited_by: ctx.agentRole,
        };
        if (title) updates.title = title;

        await ci.updateKnowledgeBaseSection(sectionId, updates);

        return {
          success: true,
          data: {
            section: section.section,
            updated_by: ctx.agentRole,
            previous_version: section.version,
          },
          memoryKeysWritten: 1,
        };
      },
    },
  ];
}
