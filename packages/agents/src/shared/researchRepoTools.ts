/**
 * Research Repository Tools — Shared tools for managing organizational research
 *
 * Tools:
 *   save_research          — Save research findings to the repository
 *   search_research        — Search across all past research
 *   get_research_timeline  — View research output over time
 *   create_research_brief  — Create a research assignment
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';

const CATEGORIES = ['competitive', 'market', 'technical', 'industry', 'ai_impact', 'organizational'] as const;

export function createResearchRepoTools(): ToolDefinition[] {
  return [
    {
      name: 'save_research',
      description:
        'Save research findings to the repository. Use this to persist completed research ' +
        'with topic, category, content, sources, tags, and confidence level for future reference.',
      parameters: {
        topic: {
          type: 'string',
          description: 'The research topic or title.',
          required: true,
        },
        category: {
          type: 'string',
          description: 'Research category.',
          required: true,
          enum: [...CATEGORIES],
        },
        content: {
          type: 'string',
          description: 'The full research content and findings.',
          required: true,
        },
        sources: {
          type: 'string',
          description: 'JSON array of source URLs or references used in the research.',
        },
        tags: {
          type: 'string',
          description: 'Comma-separated tags for categorization and discovery.',
        },
        confidence: {
          type: 'string',
          description: 'Confidence level in the research findings.',
          enum: ['low', 'medium', 'high'],
        },
      },
      async execute(params): Promise<ToolResult> {
        const topic = params.topic as string;
        const category = params.category as string;
        const content = params.content as string;
        const sources = (params.sources as string) || '[]';
        const tags = (params.tags as string) || '';
        const confidence = (params.confidence as string) || 'medium';

        try {
          // Validate sources is valid JSON
          JSON.parse(sources);

          const rows = await systemQuery<{ id: string }>(
            `INSERT INTO research_repository (topic, category, content, sources, tags, confidence, author, created_at)
             VALUES ($1, $2, $3, $4::jsonb, $5, $6, current_user, NOW())
             RETURNING id`,
            [topic, category, content, sources, tags, confidence],
          );

          return {
            success: true,
            data: {
              research_id: rows[0].id,
              topic,
              category,
              confidence,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to save research: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },

    {
      name: 'search_research',
      description:
        'Search across all past research in the repository. Matches against topic and content ' +
        'using text search. Filter by category, date range, author, or tags. Results are ranked ' +
        'by relevance with most recent first.',
      parameters: {
        query: {
          type: 'string',
          description: 'Search query to match against topic and content.',
          required: true,
        },
        category: {
          type: 'string',
          description: 'Filter by research category.',
          enum: [...CATEGORIES],
        },
        date_range: {
          type: 'string',
          description: 'Limit results to a recent time window.',
          enum: ['7d', '30d', '90d', '365d'],
        },
        author: {
          type: 'string',
          description: 'Filter by author name.',
        },
        tags: {
          type: 'string',
          description: 'Filter by tag (comma-separated; matches any).',
        },
      },
      async execute(params): Promise<ToolResult> {
        const query = params.query as string;
        const category = params.category as string | undefined;
        const dateRange = params.date_range as string | undefined;
        const author = params.author as string | undefined;
        const tags = params.tags as string | undefined;

        try {
          const conditions: string[] = ['(topic ILIKE $1 OR content ILIKE $1)'];
          const values: unknown[] = [`%${query}%`];
          let idx = 2;

          if (category) {
            conditions.push(`category = $${idx}`);
            values.push(category);
            idx++;
          }

          if (dateRange) {
            const days = parseInt(dateRange.replace('d', ''), 10);
            conditions.push(`created_at >= NOW() - INTERVAL '${days} days'`);
          }

          if (author) {
            conditions.push(`author ILIKE $${idx}`);
            values.push(`%${author}%`);
            idx++;
          }

          if (tags) {
            const tagList = tags.split(',').map((t) => t.trim()).filter(Boolean);
            const tagConditions = tagList.map((tag) => {
              conditions.push(`tags ILIKE $${idx}`);
              values.push(`%${tag}%`);
              idx++;
              return conditions.pop()!;
            });
            conditions.push(`(${tagConditions.join(' OR ')})`);
          }

          const sql = `
            SELECT id, topic, category, content, sources, tags, confidence, author, created_at
            FROM research_repository
            WHERE ${conditions.join(' AND ')}
            ORDER BY created_at DESC
            LIMIT 50`;

          const rows = await systemQuery<{
            id: string;
            topic: string;
            category: string;
            content: string;
            sources: string;
            tags: string;
            confidence: string;
            author: string;
            created_at: string;
          }>(sql, values);

          return {
            success: true,
            data: {
              query,
              resultCount: rows.length,
              results: rows.map((r) => ({
                id: r.id,
                topic: r.topic,
                category: r.category,
                content: r.content,
                sources: r.sources,
                tags: r.tags,
                confidence: r.confidence,
                author: r.author,
                created_at: r.created_at,
              })),
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Research search failed: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },

    {
      name: 'get_research_timeline',
      description:
        'View research output over time. Shows research volume grouped by week or month, ' +
        'topics covered, and identifies gaps in coverage. Useful for tracking team productivity ' +
        'and ensuring comprehensive research coverage.',
      parameters: {
        date_range: {
          type: 'string',
          description: 'Time window to analyze.',
          required: true,
          enum: ['30d', '90d', '365d'],
        },
        author: {
          type: 'string',
          description: 'Filter by author name.',
        },
      },
      async execute(params): Promise<ToolResult> {
        if (!params.date_range) return { success: false, error: 'date_range parameter is required' };
        const dateRange = params.date_range as string;
        const author = params.author as string | undefined;
        const days = parseInt(dateRange.replace('d', ''), 10);
        const groupBy = days <= 30 ? 'week' : 'month';

        try {
          const authorCondition = author ? `AND author ILIKE $1` : '';
          const authorValues = author ? [`%${author}%`] : [];

          // Research volume by period
          const volumeSql = `
            SELECT
              date_trunc('${groupBy}', created_at) AS period,
              COUNT(*) AS count,
              author
            FROM research_repository
            WHERE created_at >= NOW() - INTERVAL '${days} days'
            ${authorCondition}
            GROUP BY period, author
            ORDER BY period DESC`;

          const volumeRows = await systemQuery<{
            period: string;
            count: number;
            author: string;
          }>(volumeSql, authorValues);

          // Topics covered
          const topicsSql = `
            SELECT DISTINCT topic, category, created_at
            FROM research_repository
            WHERE created_at >= NOW() - INTERVAL '${days} days'
            ${authorCondition}
            ORDER BY created_at DESC`;

          const topicRows = await systemQuery<{
            topic: string;
            category: string;
            created_at: string;
          }>(topicsSql, authorValues);

          // Identify gaps: categories with no research in the period
          const coveredSql = `
            SELECT DISTINCT category
            FROM research_repository
            WHERE created_at >= NOW() - INTERVAL '${days} days'
            ${authorCondition}`;

          const coveredRows = await systemQuery<{ category: string }>(coveredSql, authorValues);
          const coveredCategories = new Set(coveredRows.map((r) => r.category));
          const gaps = CATEGORIES.filter((c) => !coveredCategories.has(c));

          return {
            success: true,
            data: {
              date_range: dateRange,
              group_by: groupBy,
              total_entries: volumeRows.reduce((sum, r) => sum + Number(r.count), 0),
              volume_by_period: volumeRows.map((r) => ({
                period: r.period,
                count: Number(r.count),
                author: r.author,
              })),
              topics_covered: topicRows.map((r) => ({
                topic: r.topic,
                category: r.category,
                created_at: r.created_at,
              })),
              category_gaps: gaps,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to get research timeline: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },

    {
      name: 'create_research_brief',
      description:
        'Create a research assignment brief for a team member. Defines the topic, ' +
        'research questions, assignee, and depth level. Logged as an activity for tracking.',
      parameters: {
        topic: {
          type: 'string',
          description: 'The research topic to investigate.',
          required: true,
        },
        research_questions: {
          type: 'string',
          description: 'JSON array of specific research questions to answer.',
          required: true,
        },
        assigned_to: {
          type: 'string',
          description: 'Name or role of the person assigned to this research.',
          required: true,
        },
        depth: {
          type: 'string',
          description: 'Research depth: quick (hours), standard (1-2 days), deep (week+).',
          required: true,
          enum: ['quick', 'standard', 'deep'],
        },
      },
      async execute(params): Promise<ToolResult> {
        const topic = params.topic as string;
        const researchQuestions = params.research_questions as string;
        const assignedTo = params.assigned_to as string;
        const depth = params.depth as string;

        try {
          // Validate research_questions is valid JSON array
          const questions = JSON.parse(researchQuestions);
          if (!Array.isArray(questions)) {
            return { success: false, error: 'research_questions must be a JSON array.' };
          }

          const briefData = {
            topic,
            research_questions: questions,
            assigned_to: assignedTo,
            depth,
            status: 'assigned',
            created_at: new Date().toISOString(),
          };

          const rows = await systemQuery<{ id: string }>(
            `INSERT INTO activity_log (type, data, created_at)
             VALUES ('research_brief', $1::jsonb, NOW())
             RETURNING id`,
            [JSON.stringify(briefData)],
          );

          return {
            success: true,
            data: {
              brief_id: rows[0].id,
              topic,
              assigned_to: assignedTo,
              depth,
              question_count: questions.length,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to create research brief: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },
  ];
}
