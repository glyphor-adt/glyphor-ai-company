/**
 * Research Tools — Shared tools for the Research & Intelligence team
 *
 * Provides web_search, web_fetch, and submit_research_packet tools
 * used by the 4 research analysts (Lena, Daniel, Kai, Amara).
 *
 * These tools enable real web research with structured output delivery.
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';
import { searchWeb, searchNews } from '@glyphor/integrations';

/**
 * Create research-specific tools for analyst agents.
 * These complement the shared graph/memory tools.
 */
export function createResearchTools(): ToolDefinition[] {
  return [
    {
      name: 'web_search',
      description:
        'Search the web for information. Returns structured results with titles, URLs, snippets, and dates. ' +
        'Use specific, targeted queries for best results. You can search multiple times to follow leads.',
      parameters: {
        query: {
          type: 'string',
          description: 'The search query. Be specific — include company names, product names, dates, or domain terms.',
          required: true,
        },
        num_results: {
          type: 'number',
          description: 'Number of results to return (default: 10, max: 20).',
        },
        time_range: {
          type: 'string',
          description: 'Limit to recent results: "day", "week", "month", or "year".',
          enum: ['day', 'week', 'month', 'year'],
        },
      },
      async execute(params): Promise<ToolResult> {
        const query = params.query as string;
        if (!query) {
          return { success: false, error: 'Missing required parameter: query' };
        }
        const num = Math.min((params.num_results as number) || 10, 20);
        const timeRange = params.time_range as string | undefined;

        try {
          const results = await searchWeb(query, { num, timeRange });
          return {
            success: true,
            data: {
              query,
              resultCount: results.length,
              results: results.map((r) => ({
                title: r.title,
                url: r.url,
                snippet: r.snippet,
                date: r.date || null,
              })),
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Web search failed: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },

    {
      name: 'web_fetch',
      description:
        'Fetch and read the text content of a web page. Use this to read full articles, ' +
        'product pages, pricing pages, documentation, or any URL found in search results. ' +
        'Returns the extracted text content (HTML stripped).',
      parameters: {
        url: {
          type: 'string',
          description: 'The URL to fetch and read.',
          required: true,
        },
        max_length: {
          type: 'number',
          description: 'Max characters to return (default: 8000). Increase for long articles.',
        },
      },
      async execute(params): Promise<ToolResult> {
        const url = params.url as string;
        const maxLength = (params.max_length as number) || 8000;

        // Basic URL validation
        let parsed: URL;
        try {
          parsed = new URL(url);
        } catch {
          return { success: false, error: 'Invalid URL provided.' };
        }

        // Only allow http/https
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          return { success: false, error: 'Only HTTP/HTTPS URLs are allowed.' };
        }

        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 15000);

          const response = await fetch(url, {
            signal: controller.signal,
            headers: {
              'User-Agent': 'Glyphor-Research-Agent/1.0',
              Accept: 'text/html,application/xhtml+xml,text/plain',
            },
            redirect: 'follow',
          });

          clearTimeout(timeout);

          if (!response.ok) {
            return {
              success: false,
              error: `HTTP ${response.status}: ${response.statusText}`,
            };
          }

          const html = await response.text();

          // Strip HTML tags, scripts, styles to extract readable text
          const text = html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
            .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
            .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, maxLength);

          return {
            success: true,
            data: {
              url,
              title: (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1]?.trim() || '',
              contentLength: text.length,
              text,
            },
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes('abort')) {
            return { success: false, error: 'Request timed out after 15 seconds.' };
          }
          return { success: false, error: `Fetch failed: ${msg}` };
        }
      },
    },

    {
      name: 'search_news',
      description:
        'Search for recent news articles on a topic. Returns structured results with titles, ' +
        'URLs, snippets, publication dates, and source names. Best for current events, ' +
        'funding announcements, product launches, and regulatory updates.',
      parameters: {
        query: {
          type: 'string',
          description: 'News search query. Include company names, event types, or industry terms.',
          required: true,
        },
        num_results: {
          type: 'number',
          description: 'Number of results to return (default: 10).',
        },
      },
      async execute(params): Promise<ToolResult> {
        const query = params.query as string;
        if (!query) return { success: false, error: 'Missing required parameter: query' };
        const num = Math.min((params.num_results as number) || 10, 20);

        try {
          const results = await searchNews(query, { num });
          return {
            success: true,
            data: {
              query,
              resultCount: results.length,
              results: results.map((r) => ({
                title: r.title,
                url: r.url,
                snippet: r.snippet,
                date: r.date,
                source: r.source,
              })),
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `News search failed: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },

    {
      name: 'submit_research_packet',
      description:
        'Submit your compiled research findings for a strategy analysis. ' +
        'Call this when you have finished your research and structured your findings. ' +
        'This delivers your research packet to the orchestration pipeline.',
      parameters: {
        analysis_id: {
          type: 'string',
          description: 'The strategy analysis ID this research is for.',
          required: true,
        },
        packet_type: {
          type: 'string',
          description: 'The type of research packet.',
          required: true,
          enum: ['competitor_profiles', 'market_data', 'technical_landscape', 'industry_trends',
                 'company_profile', 'strategic_direction', 'leadership_profile', 'segment_analysis',
                 'financial_analysis', 'ma_activity', 'ai_impact', 'talent_assessment',
                 'regulatory_landscape', 'risk_assessment', 'opportunity_map'],
        },
        data: {
          type: 'object',
          description: 'Structured research data matching the expected schema for this packet type.',
          required: true,
        },
        sources: {
          type: 'array',
          description: 'Array of source objects with url, title, and relevance (primary/supporting/background).',
          required: true,
          items: { type: 'object', description: 'A source reference.', properties: { url: { type: 'string', description: 'Source URL.' }, title: { type: 'string', description: 'Source title.' }, relevance: { type: 'string', description: 'Relevance level: primary, supporting, or background.' } } },
        },
        confidence_level: {
          type: 'string',
          description: 'Overall confidence in the research findings.',
          required: true,
          enum: ['high', 'medium', 'low'],
        },
        data_gaps: {
          type: 'array',
          description: 'List of things you looked for but could not find.',
          items: { type: 'string', description: 'A data gap description.' },
        },
        conflicting_data: {
          type: 'array',
          description: 'List of areas where sources disagreed.',
          items: { type: 'string', description: 'A conflicting data point.' },
        },
      },
      async execute(params): Promise<ToolResult> {
        const analysisId = params.analysis_id as string;
        const packetType = params.packet_type as string;
        if (!analysisId || !packetType) {
          return { success: false, error: 'Missing required parameters: analysis_id, packet_type' };
        }

        try {
          // Atomically merge the new packet into the JSONB column to avoid
          // race conditions when multiple analysts submit in parallel.
          // Using jsonb_set ensures concurrent writes don't overwrite each other.
          const packet = {
            data: params.data,
            sources: params.sources,
            confidenceLevel: params.confidence_level,
            dataGaps: params.data_gaps || [],
            conflictingData: params.conflicting_data || [],
            submittedAt: new Date().toISOString(),
          };

          await systemQuery('SELECT * FROM merge_research_packet($1, $2, $3)', [analysisId, packetType, JSON.stringify(packet)]);

          return {
            success: true,
            data: {
              message: `Research packet '${packetType}' submitted successfully for analysis ${analysisId}.`,
              packetType,
              sourceCount: (params.sources as unknown[])?.length || 0,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to submit research packet: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },
  ];
}
