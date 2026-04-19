import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';

async function resolveRefs(content: string): Promise<string> {
  if (!content.includes('{')) return content;
  const refs = await systemQuery<{ key: string; cached_value: string | null }>(
    'SELECT key, cached_value FROM knowledge_live_refs',
  );
  if (!refs || refs.length === 0) return content;
  const refMap = new Map(refs.map(r => [r.key, r.cached_value ?? '—']));
  return content.replace(/\{(\w+)\}/g, (match, key: string) => refMap.get(key) ?? match);
}

function normalizeKey(key: string): string {
  return key.toLowerCase().trim().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '');
}

export function createKnowledgeRetrievalTools(): ToolDefinition[] {
  return [
    {
      name: 'read_company_knowledge',
      description:
        'Retrieve company knowledge on demand. Use when you need information not in your ' +
        'injected context: competitive landscape, glossary, strategic doctrine, decision log, ' +
        'team structure, infrastructure, brand guide, or any company reference material. ' +
        'Pass section_key if you know the exact section, or topic for semantic search. ' +
        'If you do not know what sections exist, call with no args to get an index. ' +
        'The tool returns success: true even when no match is found — check the `found` field ' +
        'or `sections` array length to see if results were returned.',
      parameters: {
        section_key: {
          type: 'string',
          description:
            'Exact section key (e.g. "competitive_landscape", "glossary", "brand_guide"). ' +
            'Fuzzy-matched against available sections via trigram similarity. ' +
            'If unknown, use topic instead, or call with no args for the section index.',
          required: false,
        },
        topic: {
          type: 'string',
          description:
            'Topic to search for when the exact section key is unknown. Full-text search, top 3.',
          required: false,
        },
        include_stale: {
          type: 'boolean',
          description: 'Include sections flagged stale. Default false.',
          required: false,
        },
      },
      execute: async (params: Record<string, unknown>): Promise<ToolResult> => {
        const sectionKey = typeof params.section_key === 'string' ? params.section_key.trim() : null;
        const topic = typeof params.topic === 'string' ? params.topic.trim() : null;
        const includeStale = params.include_stale === true;
        const staleFilter = includeStale ? '' : 'AND is_stale = FALSE';

        // ── Exact section lookup with trigram fallback ──
        if (sectionKey) {
          // Tier 1: exact match
          let rows = await systemQuery<{
            section: string; title: string; content: string;
            is_stale: boolean; last_verified_at: string | null; layer: number;
          }>(
            `SELECT section, title, content, is_stale, last_verified_at, layer
             FROM company_knowledge_base
             WHERE section = $1 AND is_active = true ${staleFilter}`,
            [sectionKey],
          );

          // Tier 2: normalized exact (snake ≈ kebab ≈ spaces)
          if (rows.length === 0) {
            const normalized = normalizeKey(sectionKey);
            rows = await systemQuery(
              `SELECT section, title, content, is_stale, last_verified_at, layer
               FROM company_knowledge_base
               WHERE is_active = true ${staleFilter}
                 AND LOWER(REGEXP_REPLACE(section, '[^a-zA-Z0-9]', '_', 'g')) = $1
               LIMIT 1`,
              [normalized],
            );
          }

          if (rows.length > 0) {
            const row = rows[0];
            const resolvedContent = await resolveRefs(row.content);
            return {
              success: true,
              data: {
                found: true,
                section: row.section,
                title: row.title,
                content: resolvedContent,
                layer: row.layer,
                stale_warning: row.is_stale
                  ? 'This section is unverified. Cross-check before acting on it.'
                  : null,
              },
            };
          }

          // Tier 3: trigram similarity on section names
          // Catches: marketing_strategy ≈ standing_orders_marketing, directives ≈ founder_directives
          const trigramMatches = await systemQuery<{
            section: string; title: string; similarity: number;
          }>(
            `SELECT section, title,
                    similarity(section, $1) AS similarity
             FROM company_knowledge_base
             WHERE is_active = true ${staleFilter}
               AND similarity(section, $1) > 0.2
             ORDER BY similarity DESC
             LIMIT 5`,
            [sectionKey.replace(/[_-]/g, ' ')],
          ).catch(() => [] as { section: string; title: string; similarity: number }[]);
          // .catch([]) handles the case where pg_trgm extension isn't enabled;
          // trigram match is a nice-to-have, not required for correctness.

          // Tier 4: topic search using the key as the query
          const topicRows = await systemQuery<{
            section: string; title: string; content: string;
            is_stale: boolean; rank: number;
          }>(
            `SELECT section, title, content, is_stale,
                    ts_rank(to_tsvector('english', title || ' ' || content),
                            plainto_tsquery('english', $1)) AS rank
             FROM company_knowledge_base
             WHERE is_active = true ${staleFilter}
               AND to_tsvector('english', title || ' ' || content) @@ plainto_tsquery('english', $1)
             ORDER BY rank DESC
             LIMIT 3`,
            [sectionKey.replace(/[_-]/g, ' ')],
          ).catch(() => [] as { section: string; title: string; content: string; is_stale: boolean; rank: number }[]);

          if (topicRows.length > 0) {
            const resolved = await Promise.all(
              topicRows.map(async (r) => ({
                section: r.section,
                title: r.title,
                content: await resolveRefs(r.content),
                is_stale: r.is_stale,
              })),
            );
            return {
              success: true,
              data: {
                found: true,
                matched_via: 'topic_fallback',
                requested_section_key: sectionKey,
                did_you_mean: trigramMatches.map(r => r.section).slice(0, 3),
                sections: resolved,
                hint: `No exact section named "${sectionKey}". Returning content matched by topic search.`,
              },
            };
          }

          // Nothing matched. success: true with actionable hints.
          const availableKeys = await systemQuery<{ section: string }>(
            `SELECT section FROM company_knowledge_base WHERE is_active = true ORDER BY section`,
          );
          return {
            success: true,
            data: {
              found: false,
              requested_section_key: sectionKey,
              did_you_mean: trigramMatches.map(r => r.section).slice(0, 3),
              available_sections: availableKeys.map(r => r.section),
              hint: trigramMatches.length > 0
                ? `No section named "${sectionKey}". Did you mean: ${trigramMatches.slice(0, 3).map(r => r.section).join(', ')}?`
                : `No section named "${sectionKey}". See available_sections for valid keys, or try the topic parameter.`,
            },
          };
        }

        // ── Topic search ──
        if (topic) {
          const rows = await systemQuery<{
            section: string; title: string; content: string;
            is_stale: boolean; rank: number;
          }>(
            `SELECT section, title, content, is_stale,
                    ts_rank(to_tsvector('english', title || ' ' || content),
                            plainto_tsquery('english', $1)) AS rank
             FROM company_knowledge_base
             WHERE is_active = true ${staleFilter}
               AND to_tsvector('english', title || ' ' || content) @@ plainto_tsquery('english', $1)
             ORDER BY rank DESC
             LIMIT 3`,
            [topic],
          ).catch(() => [] as { section: string; title: string; content: string; is_stale: boolean; rank: number }[]);

          if (rows.length === 0) {
            const availableKeys = await systemQuery<{ section: string }>(
              `SELECT section FROM company_knowledge_base WHERE is_active = true ORDER BY section`,
            );
            return {
              success: true,
              data: {
                found: false,
                topic,
                sections: [],
                available_sections: availableKeys.map(r => r.section),
                hint: `No knowledge matches topic "${topic}". Try different keywords or pick from available_sections.`,
              },
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
          return {
            success: true,
            data: { found: true, topic, sections: resolved },
          };
        }

        // ── No args → index ──
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
