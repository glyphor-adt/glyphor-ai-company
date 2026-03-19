/**
 * read_company_knowledge — On-demand knowledge retrieval for any agent.
 *
 * Returns Layer 3 (and optionally Layer 2/1) sections from the
 * company_knowledge_base table. Agents use this to look up reference
 * material that is not auto-injected: competitive landscape, glossary,
 * full strategic doctrine, decision log, team structure, infrastructure,
 * brand guide, etc.
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';

/** Resolve {live_ref_key} placeholders from knowledge_live_refs table. */
async function resolveRefs(content: string): Promise<string> {
  if (!content.includes('{')) return content;
  const refs = await systemQuery<{ key: string; cached_value: string | null }>(
    'SELECT key, cached_value FROM knowledge_live_refs',
  );
  if (!refs || refs.length === 0) return content;
  const refMap = new Map(refs.map(r => [r.key, r.cached_value ?? '—']));
  return content.replace(/\{(\w+)\}/g, (match, key: string) => refMap.get(key) ?? match);
}

export function createKnowledgeRetrievalTools(): ToolDefinition[] {
  return [
    {
      name: 'read_company_knowledge',
      description:
        'Retrieve company knowledge on demand. Use when you need information not in your ' +
        'injected context: competitive landscape, glossary terms, full strategic doctrine, decision log, ' +
        'team structure details, infrastructure details, brand guide, historical decisions, or any other company ' +
        'reference material. Provide a specific section key or a topic to search semantically.',
      parameters: {
        section_key: {
          type: 'string',
          description:
            'Exact section key (e.g. "competitive_landscape", "glossary", "brand_guide", "infrastructure"). ' +
            'Use this when you know the specific section needed.',
          required: false,
        },
        topic: {
          type: 'string',
          description:
            'Topic to search for when you do not know the specific section key. Returns the most relevant section(s).',
          required: false,
        },
        include_stale: {
          type: 'boolean',
          description: 'Include sections flagged as stale. Default false.',
          required: false,
        },
      },
      execute: async (params: Record<string, unknown>): Promise<ToolResult> => {
        const sectionKey = typeof params.section_key === 'string' ? params.section_key.trim() : null;
        const topic = typeof params.topic === 'string' ? params.topic.trim() : null;
        const includeStale = params.include_stale === true;
        const staleFilter = includeStale ? '' : 'AND is_stale = FALSE';

        // Exact section lookup
        if (sectionKey) {
          const rows = await systemQuery<{
            section: string; title: string; content: string;
            is_stale: boolean; last_verified_at: string | null; layer: number;
          }>(
            `SELECT section, title, content, is_stale, last_verified_at, layer
             FROM company_knowledge_base
             WHERE section = $1 AND is_active = true ${staleFilter}`,
            [sectionKey],
          );
          if (rows.length === 0) {
            return {
              success: false,
              error: `Section '${sectionKey}' not found or is marked stale. Use include_stale: true to retrieve stale sections.`,
            };
          }
          const row = rows[0];
          const resolvedContent = await resolveRefs(row.content);
          return {
            success: true,
            data: {
              section: row.section,
              title: row.title,
              content: resolvedContent,
              layer: row.layer,
              stale_warning: row.is_stale ? 'This section is unverified. Cross-check before acting on it.' : null,
            },
          };
        }

        // Topic search using full-text search
        if (topic) {
          const rows = await systemQuery<{
            section: string; title: string; content: string;
            is_stale: boolean; last_verified_at: string | null; rank: number;
          }>(
            `SELECT section, title, content, is_stale, last_verified_at,
                    ts_rank(to_tsvector('english', title || ' ' || content),
                            plainto_tsquery('english', $1)) AS rank
             FROM company_knowledge_base
             WHERE is_active = true ${staleFilter}
               AND to_tsvector('english', title || ' ' || content) @@ plainto_tsquery('english', $1)
             ORDER BY rank DESC
             LIMIT 3`,
            [topic],
          );
          if (rows.length === 0) {
            return {
              success: false,
              error: `No knowledge sections found for topic: "${topic}". Try a different search term or use a specific section_key.`,
            };
          }
          const resolved = await Promise.all(
            rows.map(async (r) => ({
              section: r.section,
              title: r.title,
              content: await resolveRefs(r.content),
              is_stale: r.is_stale,
            })),
          );
          return { success: true, data: resolved };
        }

        // No args — return index of available sections
        const index = await systemQuery<{
          section: string; title: string; layer: number;
          audience: string; is_stale: boolean; last_verified_at: string | null;
        }>(
          `SELECT section, title, layer, audience, is_stale, last_verified_at
           FROM company_knowledge_base
           WHERE is_active = true ${staleFilter}
           ORDER BY layer, section`,
        );
        return { success: true, data: { available_sections: index } };
      },
    },
  ];
}
