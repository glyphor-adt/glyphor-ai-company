/**
 * Research Monitoring Tools — Persistent monitoring & synthesis for the Research team
 *
 * Tools provided:
 *   1.  create_monitor            — Set up persistent monitoring (all researchers)
 *   2.  check_monitors            — Run active monitors (all researchers)
 *   3.  get_monitor_history       — View historical findings (all researchers)
 *   4.  track_competitor_product   — Deep competitor product tracking (Lena)
 *   5.  search_academic_papers     — Search academic databases (Kai)
 *   6.  track_open_source          — Monitor OSS projects (Kai)
 *   7.  track_industry_events      — Monitor industry events (Amara)
 *   8.  track_regulatory_changes   — Monitor AI regulation (Amara)
 *   9.  analyze_ai_adoption        — Research AI adoption patterns (Riya)
 *   10. track_ai_benchmarks        — Monitor AI benchmarks (Riya)
 *   11. analyze_org_structure      — Analyze org patterns (Marcus)
 *   12. compile_research_digest    — Compile research digest (Sophia)
 *   13. identify_research_gaps     — Find research blind spots (Sophia)
 *   14. cross_reference_findings   — Find connections across research (Sophia)
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';

/** Map date-range shorthand to interval days. */
function intervalDays(range: string): number {
  switch (range) {
    case '7d': return 7;
    case '30d': return 30;
    case '90d': return 90;
    case '365d': return 365;
    default: return 30;
  }
}

export function createResearchMonitoringTools(): ToolDefinition[] {
  return [
    // ────────────────────────────────────────────
    // 1. create_monitor
    // ────────────────────────────────────────────
    {
      name: 'create_monitor',
      description:
        'Set up persistent monitoring for a topic, company, keyword, technology, or regulation. ' +
        'Creates a research_monitors entry that is checked on the specified frequency.',
      parameters: {
        name: {
          type: 'string',
          description: 'Human-readable name for this monitor.',
          required: true,
        },
        monitor_type: {
          type: 'string',
          description: 'What category of monitoring to perform.',
          required: true,
          enum: ['company', 'topic', 'keyword', 'technology', 'regulation'],
        },
        query_terms: {
          type: 'string',
          description: 'Comma-separated search terms the monitor should track.',
          required: true,
        },
        check_frequency: {
          type: 'string',
          description: 'How often to run this monitor.',
          enum: ['daily', 'weekly'],
        },
        alert_threshold: {
          type: 'number',
          description: 'Optional relevance score threshold (0–100) to trigger an alert.',
        },
      },
      async execute(params): Promise<ToolResult> {
        const name = params.name as string;
        const monitorType = params.monitor_type as string;
        const queryTerms = params.query_terms as string;
        const frequency = (params.check_frequency as string) || 'daily';
        const threshold = (params.alert_threshold as number) || 50;

        try {
          const rows = await systemQuery<{ id: string }>(
            `INSERT INTO research_monitors (name, type, query_terms, check_frequency, alert_threshold, created_by, created_at)
             VALUES ($1, $2, $3, $4, $5, current_user, NOW())
             RETURNING id`,
            [name, monitorType, queryTerms, frequency, threshold],
          );
          return {
            success: true,
            data: {
              monitor_id: rows[0].id,
              name,
              type: monitorType,
              query_terms: queryTerms,
              check_frequency: frequency,
              alert_threshold: threshold,
            },
          };
        } catch (err) {
          return { success: false, error: `Failed to create monitor: ${err instanceof Error ? err.message : String(err)}` };
        }
      },
    },

    // ────────────────────────────────────────────
    // 2. check_monitors
    // ────────────────────────────────────────────
    {
      name: 'check_monitors',
      description:
        'Run all active monitors and return their current status. ' +
        'Optionally filter by monitor type.',
      parameters: {
        monitor_type: {
          type: 'string',
          description: 'Optional filter by monitor type (company, topic, keyword, technology, regulation).',
        },
      },
      async execute(params): Promise<ToolResult> {
        const monitorType = params.monitor_type as string | undefined;

        try {
          const conditions = ['1=1'];
          const values: unknown[] = [];
          if (monitorType) {
            values.push(monitorType);
            conditions.push(`type = $${values.length}`);
          }

          const monitors = await systemQuery<{
            id: string; name: string; type: string; query_terms: string;
            check_frequency: string; last_checked: string | null;
          }>(
            `SELECT id, name, type, query_terms, check_frequency, last_checked
             FROM research_monitors
             WHERE ${conditions.join(' AND ')}
             ORDER BY last_checked ASC NULLS FIRST`,
            values,
          );

          return {
            success: true,
            data: {
              total: monitors.length,
              monitors: monitors.map((m) => ({
                id: m.id,
                name: m.name,
                type: m.type,
                query_terms: m.query_terms,
                check_frequency: m.check_frequency,
                last_checked: m.last_checked || 'never',
              })),
            },
          };
        } catch (err) {
          return { success: false, error: `Failed to check monitors: ${err instanceof Error ? err.message : String(err)}` };
        }
      },
    },

    // ────────────────────────────────────────────
    // 3. get_monitor_history
    // ────────────────────────────────────────────
    {
      name: 'get_monitor_history',
      description:
        'View historical findings for a specific monitor. ' +
        'Returns a timeline of activity_log entries linked to monitor checks.',
      parameters: {
        monitor_id: {
          type: 'string',
          description: 'The ID of the monitor to view history for.',
          required: true,
        },
        date_range: {
          type: 'string',
          description: 'How far back to look.',
          enum: ['7d', '30d', '90d'],
        },
      },
      async execute(params): Promise<ToolResult> {
        const monitorId = params.monitor_id as string;
        const days = intervalDays((params.date_range as string) || '30d');

        try {
          const findings = await systemQuery<{
            id: string; action: string; summary: string; details: unknown; created_at: string;
          }>(
            `SELECT id, action, summary, details, created_at
             FROM activity_log
             WHERE details->>'monitor_id' = $1
               AND created_at >= NOW() - INTERVAL '${days} days'
             ORDER BY created_at DESC`,
            [monitorId],
          );

          return {
            success: true,
            data: {
              monitor_id: monitorId,
              date_range: `${days}d`,
              finding_count: findings.length,
              timeline: findings.map((f) => ({
                id: f.id,
                action: f.action,
                summary: f.summary,
                details: f.details,
                date: f.created_at,
              })),
            },
          };
        } catch (err) {
          return { success: false, error: `Failed to get monitor history: ${err instanceof Error ? err.message : String(err)}` };
        }
      },
    },

    // ────────────────────────────────────────────
    // 4. track_competitor_product (Lena)
    // ────────────────────────────────────────────
    {
      name: 'track_competitor_product',
      description:
        'Deep competitor product tracking. Queries company_research and research_repository ' +
        'for detailed product intelligence on a specific competitor.',
      parameters: {
        competitor: {
          type: 'string',
          description: 'The competitor company name.',
          required: true,
        },
        product: {
          type: 'string',
          description: 'The product or product line to track.',
          required: true,
        },
      },
      async execute(params): Promise<ToolResult> {
        const competitor = params.competitor as string;
        const product = params.product as string;

        try {
          const companyData = await systemQuery<{
            id: string; source: string; content: unknown; updated_at: string;
          }>(
            `SELECT id, source, content, updated_at
             FROM company_research
             WHERE LOWER(name) = LOWER($1)
             ORDER BY updated_at DESC`,
            [competitor],
          );

          const repoEntries = await systemQuery<{
            id: string; topic: string; content: string; sources: unknown;
            confidence: string; author: string; created_at: string;
          }>(
            `SELECT id, topic, content, sources, confidence, author, created_at
             FROM research_repository
             WHERE category = 'competitive'
               AND (LOWER(topic) LIKE $1 OR LOWER(content) LIKE $1)
             ORDER BY created_at DESC
             LIMIT 20`,
            [`%${product.toLowerCase()}%`],
          );

          return {
            success: true,
            data: {
              competitor,
              product,
              company_sources: companyData.length,
              research_entries: repoEntries.length,
              company_data: companyData.map((c) => ({
                source: c.source,
                content: c.content,
                updated_at: c.updated_at,
              })),
              research: repoEntries.map((r) => ({
                id: r.id,
                topic: r.topic,
                confidence: r.confidence,
                author: r.author,
                date: r.created_at,
              })),
            },
          };
        } catch (err) {
          return { success: false, error: `Failed to track competitor product: ${err instanceof Error ? err.message : String(err)}` };
        }
      },
    },

    // ────────────────────────────────────────────
    // 5. search_academic_papers (Kai)
    // ────────────────────────────────────────────
    {
      name: 'search_academic_papers',
      description:
        'Search academic databases (arXiv, Google Scholar) for research papers. ' +
        'Returns structured paper summaries with title, authors, abstract, URL, and date.',
      parameters: {
        query: {
          type: 'string',
          description: 'The academic search query.',
          required: true,
        },
        source: {
          type: 'string',
          description: 'Which database to search.',
          enum: ['arxiv', 'scholar', 'all'],
        },
        max_results: {
          type: 'number',
          description: 'Maximum number of papers to return (default: 10).',
        },
      },
      async execute(params): Promise<ToolResult> {
        const query = params.query as string;
        const source = (params.source as string) || 'all';
        const maxResults = Math.min((params.max_results as number) || 10, 30);

        try {
          const urls: string[] = [];
          if (source === 'arxiv' || source === 'all') {
            urls.push(`https://export.arxiv.org/api/query?search_query=${encodeURIComponent(query)}&max_results=${maxResults}`);
          }
          if (source === 'scholar' || source === 'all') {
            urls.push(`https://scholar.google.com/scholar?q=${encodeURIComponent(query)}&num=${maxResults}`);
          }

          const results: Array<{
            title: string; authors: string; abstract: string; url: string; date: string; source: string;
          }> = [];

          for (const url of urls) {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 15000);

            const response = await fetch(url, {
              signal: controller.signal,
              headers: { 'User-Agent': 'Glyphor-Research-Agent/1.0' },
            });
            clearTimeout(timeout);

            if (!response.ok) continue;

            const text = await response.text();
            const isArxiv = url.includes('arxiv.org');

            if (isArxiv) {
              // Parse arXiv Atom XML entries
              const entries = text.split('<entry>').slice(1);
              for (const entry of entries.slice(0, maxResults)) {
                results.push({
                  title: (entry.match(/<title>([\s\S]*?)<\/title>/) || [])[1]?.trim() || '',
                  authors: (entry.match(/<name>([\s\S]*?)<\/name>/g) || [])
                    .map((a) => a.replace(/<\/?name>/g, '').trim()).join(', '),
                  abstract: (entry.match(/<summary>([\s\S]*?)<\/summary>/) || [])[1]?.trim() || '',
                  url: (entry.match(/<id>([\s\S]*?)<\/id>/) || [])[1]?.trim() || '',
                  date: (entry.match(/<published>([\s\S]*?)<\/published>/) || [])[1]?.trim() || '',
                  source: 'arxiv',
                });
              }
            } else {
              // Parse Google Scholar HTML (best-effort)
              const blocks = text.split('class="gs_ri"').slice(1);
              for (const block of blocks.slice(0, maxResults)) {
                results.push({
                  title: (block.match(/<h3[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/) || [])[1]
                    ?.replace(/<[^>]+>/g, '').trim() || '',
                  authors: (block.match(/class="gs_a">([\s\S]*?)<\/div>/) || [])[1]
                    ?.replace(/<[^>]+>/g, '').trim() || '',
                  abstract: (block.match(/class="gs_rs">([\s\S]*?)<\/div>/) || [])[1]
                    ?.replace(/<[^>]+>/g, '').trim() || '',
                  url: (block.match(/href="(https?:\/\/[^"]+)"/) || [])[1] || '',
                  date: '',
                  source: 'scholar',
                });
              }
            }
          }

          return {
            success: true,
            data: {
              query,
              source,
              result_count: results.length,
              papers: results,
            },
          };
        } catch (err) {
          return { success: false, error: `Academic search failed: ${err instanceof Error ? err.message : String(err)}` };
        }
      },
    },

    // ────────────────────────────────────────────
    // 6. track_open_source (Kai)
    // ────────────────────────────────────────────
    {
      name: 'track_open_source',
      description:
        'Monitor open-source projects by category. Queries research_repository ' +
        'for OSS-related entries in the technical category.',
      parameters: {
        project: {
          type: 'string',
          description: 'Specific project name to track (optional — omit for category overview).',
        },
        category: {
          type: 'string',
          description: 'OSS category to filter by.',
          enum: ['ai_ml', 'devtools', 'infrastructure', 'all'],
        },
      },
      async execute(params): Promise<ToolResult> {
        const project = params.project as string | undefined;
        const category = (params.category as string) || 'all';

        try {
          const conditions = ["category = 'technical'"];
          const values: unknown[] = [];

          if (project) {
            values.push(`%${project.toLowerCase()}%`);
            conditions.push(`(LOWER(topic) LIKE $${values.length} OR LOWER(tags) LIKE $${values.length})`);
          }
          if (category !== 'all') {
            values.push(`%${category}%`);
            conditions.push(`LOWER(tags) LIKE $${values.length}`);
          }

          const entries = await systemQuery<{
            id: string; topic: string; content: string; tags: string;
            confidence: string; author: string; created_at: string;
          }>(
            `SELECT id, topic, content, tags, confidence, author, created_at
             FROM research_repository
             WHERE ${conditions.join(' AND ')}
             ORDER BY created_at DESC
             LIMIT 30`,
            values,
          );

          return {
            success: true,
            data: {
              project: project || 'all',
              category,
              entry_count: entries.length,
              projects: entries.map((e) => ({
                id: e.id,
                topic: e.topic,
                tags: e.tags,
                confidence: e.confidence,
                author: e.author,
                date: e.created_at,
              })),
            },
          };
        } catch (err) {
          return { success: false, error: `Failed to track open source: ${err instanceof Error ? err.message : String(err)}` };
        }
      },
    },

    // ────────────────────────────────────────────
    // 7. track_industry_events (Amara)
    // ────────────────────────────────────────────
    {
      name: 'track_industry_events',
      description:
        'Monitor industry events such as conferences, webinars, and report releases. ' +
        'Queries activity_log and research_repository for event-related entries.',
      parameters: {
        industry: {
          type: 'string',
          description: 'Industry to filter events for (optional).',
        },
        event_type: {
          type: 'string',
          description: 'Type of event to look for.',
          enum: ['conference', 'webinar', 'report', 'all'],
        },
      },
      async execute(params): Promise<ToolResult> {
        const industry = params.industry as string | undefined;
        const eventType = (params.event_type as string) || 'all';

        try {
          // Query research_repository for industry entries
          const repoConditions = ["category = 'industry'"];
          const repoValues: unknown[] = [];

          if (industry) {
            repoValues.push(`%${industry.toLowerCase()}%`);
            repoConditions.push(`LOWER(content) LIKE $${repoValues.length}`);
          }
          if (eventType !== 'all') {
            repoValues.push(`%${eventType}%`);
            repoConditions.push(`LOWER(tags) LIKE $${repoValues.length}`);
          }

          const repoEntries = await systemQuery<{
            id: string; topic: string; tags: string; confidence: string;
            author: string; created_at: string;
          }>(
            `SELECT id, topic, tags, confidence, author, created_at
             FROM research_repository
             WHERE ${repoConditions.join(' AND ')}
             ORDER BY created_at DESC
             LIMIT 30`,
            repoValues,
          );

          // Query activity_log for event-related actions
          const logConditions = ["action LIKE '%event%'"];
          const logValues: unknown[] = [];

          if (industry) {
            logValues.push(`%${industry.toLowerCase()}%`);
            logConditions.push(`LOWER(summary) LIKE $${logValues.length}`);
          }

          const logEntries = await systemQuery<{
            id: string; action: string; summary: string; created_at: string;
          }>(
            `SELECT id, action, summary, created_at
             FROM activity_log
             WHERE ${logConditions.join(' AND ')}
             ORDER BY created_at DESC
             LIMIT 20`,
            logValues,
          );

          return {
            success: true,
            data: {
              industry: industry || 'all',
              event_type: eventType,
              research_entries: repoEntries.length,
              activity_entries: logEntries.length,
              events: repoEntries.map((e) => ({
                id: e.id,
                topic: e.topic,
                tags: e.tags,
                confidence: e.confidence,
                author: e.author,
                date: e.created_at,
              })),
              activity: logEntries.map((l) => ({
                id: l.id,
                action: l.action,
                summary: l.summary,
                date: l.created_at,
              })),
            },
          };
        } catch (err) {
          return { success: false, error: `Failed to track industry events: ${err instanceof Error ? err.message : String(err)}` };
        }
      },
    },

    // ────────────────────────────────────────────
    // 8. track_regulatory_changes (Amara)
    // ────────────────────────────────────────────
    {
      name: 'track_regulatory_changes',
      description:
        'Monitor AI regulation changes by jurisdiction. Queries research_repository ' +
        'for regulation-category entries within a date range.',
      parameters: {
        jurisdiction: {
          type: 'string',
          description: 'Jurisdiction to monitor.',
          enum: ['us', 'eu', 'uk', 'global', 'all'],
        },
        date_range: {
          type: 'string',
          description: 'How far back to look for changes.',
          enum: ['30d', '90d', '365d'],
        },
      },
      async execute(params): Promise<ToolResult> {
        const jurisdiction = (params.jurisdiction as string) || 'all';
        const days = intervalDays((params.date_range as string) || '90d');

        try {
          const conditions = [
            "category = 'industry'",
            "LOWER(tags) LIKE '%regulation%'",
            `created_at >= NOW() - INTERVAL '${days} days'`,
          ];
          const values: unknown[] = [];

          if (jurisdiction !== 'all') {
            values.push(`%${jurisdiction}%`);
            conditions.push(`LOWER(content) LIKE $${values.length}`);
          }

          const entries = await systemQuery<{
            id: string; topic: string; content: string; tags: string;
            confidence: string; author: string; created_at: string;
          }>(
            `SELECT id, topic, content, tags, confidence, author, created_at
             FROM research_repository
             WHERE ${conditions.join(' AND ')}
             ORDER BY created_at DESC
             LIMIT 30`,
            values,
          );

          return {
            success: true,
            data: {
              jurisdiction,
              date_range: `${days}d`,
              change_count: entries.length,
              changes: entries.map((e) => ({
                id: e.id,
                topic: e.topic,
                tags: e.tags,
                confidence: e.confidence,
                author: e.author,
                date: e.created_at,
                excerpt: e.content.slice(0, 300),
              })),
            },
          };
        } catch (err) {
          return { success: false, error: `Failed to track regulatory changes: ${err instanceof Error ? err.message : String(err)}` };
        }
      },
    },

    // ────────────────────────────────────────────
    // 9. analyze_ai_adoption (Riya)
    // ────────────────────────────────────────────
    {
      name: 'analyze_ai_adoption',
      description:
        'Research AI adoption patterns across industries and company sizes. ' +
        'Queries research_repository for ai_impact category entries.',
      parameters: {
        industry: {
          type: 'string',
          description: 'Industry to analyze (optional — omit for cross-industry view).',
        },
        company_size: {
          type: 'string',
          description: 'Company size segment to focus on.',
          enum: ['startup', 'smb', 'enterprise', 'all'],
        },
      },
      async execute(params): Promise<ToolResult> {
        const industry = params.industry as string | undefined;
        const companySize = (params.company_size as string) || 'all';

        try {
          const conditions = ["category = 'ai_impact'"];
          const values: unknown[] = [];

          if (industry) {
            values.push(`%${industry.toLowerCase()}%`);
            conditions.push(`LOWER(content) LIKE $${values.length}`);
          }
          if (companySize !== 'all') {
            values.push(`%${companySize}%`);
            conditions.push(`LOWER(tags) LIKE $${values.length}`);
          }

          const entries = await systemQuery<{
            id: string; topic: string; content: string; tags: string;
            confidence: string; author: string; created_at: string;
          }>(
            `SELECT id, topic, content, tags, confidence, author, created_at
             FROM research_repository
             WHERE ${conditions.join(' AND ')}
             ORDER BY created_at DESC
             LIMIT 30`,
            values,
          );

          return {
            success: true,
            data: {
              industry: industry || 'all',
              company_size: companySize,
              entry_count: entries.length,
              findings: entries.map((e) => ({
                id: e.id,
                topic: e.topic,
                tags: e.tags,
                confidence: e.confidence,
                author: e.author,
                date: e.created_at,
                excerpt: e.content.slice(0, 300),
              })),
            },
          };
        } catch (err) {
          return { success: false, error: `Failed to analyze AI adoption: ${err instanceof Error ? err.message : String(err)}` };
        }
      },
    },

    // ────────────────────────────────────────────
    // 10. track_ai_benchmarks (Riya)
    // ────────────────────────────────────────────
    {
      name: 'track_ai_benchmarks',
      description:
        'Monitor AI model benchmarks across categories. Queries research_repository ' +
        'for technical and ai_impact entries about benchmarks.',
      parameters: {
        model_category: {
          type: 'string',
          description: 'Category of AI models to track.',
          enum: ['language', 'vision', 'multimodal', 'all'],
        },
        date_range: {
          type: 'string',
          description: 'How far back to look.',
          enum: ['30d', '90d'],
        },
      },
      async execute(params): Promise<ToolResult> {
        const modelCategory = (params.model_category as string) || 'all';
        const days = intervalDays((params.date_range as string) || '30d');

        try {
          const conditions = [
            "category IN ('technical', 'ai_impact')",
            "LOWER(tags) LIKE '%benchmark%'",
            `created_at >= NOW() - INTERVAL '${days} days'`,
          ];
          const values: unknown[] = [];

          if (modelCategory !== 'all') {
            values.push(`%${modelCategory}%`);
            conditions.push(`LOWER(content) LIKE $${values.length}`);
          }

          const entries = await systemQuery<{
            id: string; topic: string; content: string; tags: string;
            confidence: string; author: string; created_at: string;
          }>(
            `SELECT id, topic, content, tags, confidence, author, created_at
             FROM research_repository
             WHERE ${conditions.join(' AND ')}
             ORDER BY created_at DESC
             LIMIT 30`,
            values,
          );

          return {
            success: true,
            data: {
              model_category: modelCategory,
              date_range: `${days}d`,
              benchmark_count: entries.length,
              benchmarks: entries.map((e) => ({
                id: e.id,
                topic: e.topic,
                tags: e.tags,
                confidence: e.confidence,
                author: e.author,
                date: e.created_at,
                excerpt: e.content.slice(0, 300),
              })),
            },
          };
        } catch (err) {
          return { success: false, error: `Failed to track AI benchmarks: ${err instanceof Error ? err.message : String(err)}` };
        }
      },
    },

    // ────────────────────────────────────────────
    // 11. analyze_org_structure (Marcus)
    // ────────────────────────────────────────────
    {
      name: 'analyze_org_structure',
      description:
        'Analyze organizational patterns for a company. Queries company_research and ' +
        'research_repository for hiring, structure, and talent data.',
      parameters: {
        company_name: {
          type: 'string',
          description: 'The company to analyze.',
          required: true,
        },
        focus: {
          type: 'string',
          description: 'Which aspect of the organization to focus on.',
          enum: ['hiring', 'structure', 'talent', 'all'],
        },
      },
      async execute(params): Promise<ToolResult> {
        const companyName = params.company_name as string;
        const focus = (params.focus as string) || 'all';

        try {
          const companyData = await systemQuery<{
            id: string; source: string; content: unknown; updated_at: string;
          }>(
            `SELECT id, source, content, updated_at
             FROM company_research
             WHERE LOWER(name) = LOWER($1)
             ORDER BY updated_at DESC`,
            [companyName],
          );

          const repoConditions = ["category = 'organizational'"];
          const repoValues: unknown[] = [`%${companyName.toLowerCase()}%`];
          repoConditions.push(`LOWER(content) LIKE $${repoValues.length}`);

          if (focus !== 'all') {
            repoValues.push(`%${focus}%`);
            repoConditions.push(`(LOWER(tags) LIKE $${repoValues.length} OR LOWER(topic) LIKE $${repoValues.length})`);
          }

          const repoEntries = await systemQuery<{
            id: string; topic: string; content: string; tags: string;
            confidence: string; author: string; created_at: string;
          }>(
            `SELECT id, topic, content, tags, confidence, author, created_at
             FROM research_repository
             WHERE ${repoConditions.join(' AND ')}
             ORDER BY created_at DESC
             LIMIT 20`,
            repoValues,
          );

          return {
            success: true,
            data: {
              company: companyName,
              focus,
              company_sources: companyData.length,
              research_entries: repoEntries.length,
              company_data: companyData.map((c) => ({
                source: c.source,
                content: c.content,
                updated_at: c.updated_at,
              })),
              research: repoEntries.map((r) => ({
                id: r.id,
                topic: r.topic,
                tags: r.tags,
                confidence: r.confidence,
                author: r.author,
                date: r.created_at,
              })),
            },
          };
        } catch (err) {
          return { success: false, error: `Failed to analyze org structure: ${err instanceof Error ? err.message : String(err)}` };
        }
      },
    },

    // ────────────────────────────────────────────
    // 12. compile_research_digest (Sophia)
    // ────────────────────────────────────────────
    {
      name: 'compile_research_digest',
      description:
        'Compile a research digest from recent entries in research_repository. ' +
        'Groups findings by category and returns an executive summary structure.',
      parameters: {
        date_range: {
          type: 'string',
          description: 'How far back to include.',
          enum: ['7d', '30d'],
        },
        focus_areas: {
          type: 'string',
          description: 'Optional comma-separated list of categories to focus on.',
        },
      },
      async execute(params): Promise<ToolResult> {
        const days = intervalDays((params.date_range as string) || '7d');
        const focusAreas = params.focus_areas as string | undefined;

        try {
          const conditions = [`created_at >= NOW() - INTERVAL '${days} days'`];
          const values: unknown[] = [];

          if (focusAreas) {
            const areas = focusAreas.split(',').map((a) => a.trim().toLowerCase());
            conditions.push(`LOWER(category) IN (${areas.map((_, i) => `$${values.length + i + 1}`).join(', ')})`);
            values.push(...areas);
          }

          // Group by category to build digest
          const summary = await systemQuery<{
            category: string; entry_count: number; latest: string;
          }>(
            `SELECT category, COUNT(*)::int AS entry_count, MAX(created_at) AS latest
             FROM research_repository
             WHERE ${conditions.join(' AND ')}
             GROUP BY category
             ORDER BY entry_count DESC`,
            values,
          );

          // Get top entries per category
          const topEntries = await systemQuery<{
            id: string; topic: string; category: string; confidence: string;
            author: string; created_at: string;
          }>(
            `SELECT DISTINCT ON (category) id, topic, category, confidence, author, created_at
             FROM research_repository
             WHERE ${conditions.join(' AND ')}
             ORDER BY category, created_at DESC`,
            values,
          );

          return {
            success: true,
            data: {
              date_range: `${days}d`,
              focus_areas: focusAreas || 'all',
              total_categories: summary.length,
              category_summary: summary.map((s) => ({
                category: s.category,
                entry_count: s.entry_count,
                latest_entry: s.latest,
              })),
              highlights: topEntries.map((e) => ({
                id: e.id,
                topic: e.topic,
                category: e.category,
                confidence: e.confidence,
                author: e.author,
                date: e.created_at,
              })),
            },
          };
        } catch (err) {
          return { success: false, error: `Failed to compile research digest: ${err instanceof Error ? err.message : String(err)}` };
        }
      },
    },

    // ────────────────────────────────────────────
    // 13. identify_research_gaps (Sophia)
    // ────────────────────────────────────────────
    {
      name: 'identify_research_gaps',
      description:
        'Find research blind spots by analyzing coverage across categories. ' +
        'Identifies topics with no recent research and under-covered areas.',
      parameters: {},
      async execute(): Promise<ToolResult> {
        try {
          // Coverage by category in last 30 days
          const coverage = await systemQuery<{
            category: string; entry_count: number; author_count: number; latest: string;
          }>(
            `SELECT category,
                    COUNT(*)::int AS entry_count,
                    COUNT(DISTINCT author)::int AS author_count,
                    MAX(created_at) AS latest
             FROM research_repository
             WHERE created_at >= NOW() - INTERVAL '30 days'
             GROUP BY category
             ORDER BY entry_count ASC`,
          );

          // All known categories to detect missing ones
          const allCategories = [
            'competitive', 'market', 'technical', 'industry', 'ai_impact', 'organizational',
          ];
          const coveredCategories = coverage.map((c) => c.category);
          const missingCategories = allCategories.filter((c) => !coveredCategories.includes(c));

          // Topics that haven't been updated in 60+ days
          const stale = await systemQuery<{
            category: string; topic: string; author: string; created_at: string;
          }>(
            `SELECT category, topic, author, created_at
             FROM research_repository
             WHERE created_at < NOW() - INTERVAL '60 days'
               AND id NOT IN (
                 SELECT id FROM research_repository
                 WHERE created_at >= NOW() - INTERVAL '60 days'
               )
             ORDER BY created_at ASC
             LIMIT 20`,
          );

          return {
            success: true,
            data: {
              missing_categories: missingCategories,
              under_covered: coverage
                .filter((c) => c.entry_count < 3)
                .map((c) => ({
                  category: c.category,
                  entry_count: c.entry_count,
                  author_count: c.author_count,
                  latest: c.latest,
                })),
              stale_topics: stale.map((s) => ({
                category: s.category,
                topic: s.topic,
                author: s.author,
                last_updated: s.created_at,
              })),
              coverage_summary: coverage.map((c) => ({
                category: c.category,
                entries: c.entry_count,
                authors: c.author_count,
                latest: c.latest,
              })),
            },
          };
        } catch (err) {
          return { success: false, error: `Failed to identify research gaps: ${err instanceof Error ? err.message : String(err)}` };
        }
      },
    },

    // ────────────────────────────────────────────
    // 14. cross_reference_findings (Sophia)
    // ────────────────────────────────────────────
    {
      name: 'cross_reference_findings',
      description:
        'Find connections across research from different authors and categories. ' +
        'Uses text search to surface related findings for a given research entry or topic.',
      parameters: {
        research_id: {
          type: 'string',
          description: 'ID of a specific research entry to find connections for (optional).',
        },
        topic: {
          type: 'string',
          description: 'Topic or keyword to search for connections (optional).',
        },
      },
      async execute(params): Promise<ToolResult> {
        const researchId = params.research_id as string | undefined;
        const topic = params.topic as string | undefined;

        if (!researchId && !topic) {
          return { success: false, error: 'Provide at least one of research_id or topic.' };
        }

        try {
          let searchTerms = topic || '';

          // If research_id provided, get its topic for cross-referencing
          if (researchId) {
            const source = await systemQuery<{ topic: string; category: string; content: string }>(
              `SELECT topic, category, content
               FROM research_repository
               WHERE id = $1`,
              [researchId],
            );
            if (source.length === 0) {
              return { success: false, error: `Research entry ${researchId} not found.` };
            }
            searchTerms = searchTerms || source[0].topic;
          }

          // Find related entries from different authors/categories
          const conditions = [`LOWER(content) LIKE $1 OR LOWER(topic) LIKE $1`];
          const values: unknown[] = [`%${searchTerms.toLowerCase()}%`];

          if (researchId) {
            conditions.push(`id != $2`);
            values.push(researchId);
          }

          const related = await systemQuery<{
            id: string; topic: string; category: string; content: string;
            confidence: string; author: string; created_at: string;
          }>(
            `SELECT id, topic, category, content, confidence, author, created_at
             FROM research_repository
             WHERE ${conditions.join(' AND ')}
             ORDER BY created_at DESC
             LIMIT 20`,
            values,
          );

          // Group by author to highlight cross-team connections
          const byAuthor: Record<string, number> = {};
          for (const r of related) {
            byAuthor[r.author] = (byAuthor[r.author] || 0) + 1;
          }

          return {
            success: true,
            data: {
              search_terms: searchTerms,
              source_id: researchId || null,
              related_count: related.length,
              authors_involved: Object.keys(byAuthor).length,
              by_author: byAuthor,
              findings: related.map((r) => ({
                id: r.id,
                topic: r.topic,
                category: r.category,
                confidence: r.confidence,
                author: r.author,
                date: r.created_at,
                excerpt: r.content.slice(0, 200),
              })),
            },
          };
        } catch (err) {
          return { success: false, error: `Failed to cross-reference findings: ${err instanceof Error ? err.message : String(err)}` };
        }
      },
    },
  ];
}
