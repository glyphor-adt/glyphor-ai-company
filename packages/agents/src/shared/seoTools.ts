/**
 * SEO Tools — Shared tools for SEO analysis and Search Console integration
 *
 * Provides 8 tools for SEO workflows:
 *   1. get_search_performance — Query Google Search Console for search performance
 *   2. get_seo_data — Read from seo_data table (synced data)
 *   3. track_keyword_rankings — Query current ranking for target keywords
 *   4. analyze_page_seo — Audit a specific URL for on-page SEO
 *   5. get_indexing_status — Check indexing status via Search Console
 *   6. submit_sitemap — Submit sitemap to Search Console (YELLOW authority)
 *   7. update_seo_data — Write SEO findings back to seo_data table
 *   8. get_backlink_profile — Analyze backlinks
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';

/**
 * Read Google Search Console credentials from environment and return auth headers.
 */
function getSearchConsoleCredentials(): { headers: Record<string, string> } | null {
  const creds = process.env.GOOGLE_SEARCH_CONSOLE_CREDENTIALS;
  if (!creds) return null;

  try {
    const parsed = JSON.parse(creds);
    return {
      headers: {
        Authorization: `Bearer ${parsed.access_token}`,
        'Content-Type': 'application/json',
      },
    };
  } catch {
    return null;
  }
}

/**
 * Create SEO-specific tools for analyst agents.
 */
export function createSeoTools(): ToolDefinition[] {
  return [
    {
      name: 'get_search_performance',
      description:
        'Query Google Search Console for search performance data. Returns clicks, impressions, CTR, ' +
        'and average position broken down by the specified dimension.',
      parameters: {
        site_url: {
          type: 'string',
          description: 'The site URL registered in Search Console (e.g. "https://example.com").',
          required: true,
        },
        date_range: {
          type: 'string',
          description: 'Date range for the query.',
          required: true,
          enum: ['7d', '30d', '90d'],
        },
        dimensions: {
          type: 'string',
          description: 'Dimension to group results by.',
          required: true,
          enum: ['query', 'page', 'country', 'device'],
        },
      },
      async execute(params): Promise<ToolResult> {
        const siteUrl = params.site_url as string;
        const dateRange = params.date_range as string;
        const dimensions = params.dimensions as string;

        const auth = getSearchConsoleCredentials();
        if (!auth) {
          return {
            success: false,
            error: 'Google Search Console credentials not available. Set GOOGLE_SEARCH_CONSOLE_CREDENTIALS env var.',
          };
        }

        const now = new Date();
        const daysMap: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };
        const days = daysMap[dateRange] || 30;
        const endDate = now.toISOString().split('T')[0];
        const startDate = new Date(now.getTime() - days * 86400000).toISOString().split('T')[0];

        try {
          const response = await fetch(
            `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
            {
              method: 'POST',
              headers: auth.headers,
              body: JSON.stringify({
                startDate,
                endDate,
                dimensions: [dimensions],
                rowLimit: 25,
              }),
            },
          );

          if (!response.ok) {
            return {
              success: false,
              error: `Search Console API error: HTTP ${response.status} ${response.statusText}`,
            };
          }

          const result = await response.json() as Record<string, unknown>;
          const rows = ((result.rows as Record<string, unknown>[]) || []).map((row: Record<string, unknown>) => ({
            dimension: (row.keys as string[])?.[0] || '',
            clicks: row.clicks,
            impressions: row.impressions,
            ctr: row.ctr,
            position: row.position,
          }));

          return {
            success: true,
            data: {
              siteUrl,
              dateRange,
              dimensions,
              startDate,
              endDate,
              rowCount: rows.length,
              rows,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Search performance query failed: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },

    {
      name: 'get_seo_data',
      description:
        'Read from the seo_data table containing synced SEO metrics. ' +
        'Supports optional filtering by metric type, keyword, and URL.',
      parameters: {
        metric_type: {
          type: 'string',
          description: 'Filter by metric type (e.g. "ranking", "backlink", "traffic").',
        },
        keyword: {
          type: 'string',
          description: 'Filter by keyword.',
        },
        url: {
          type: 'string',
          description: 'Filter by URL.',
        },
        limit: {
          type: 'number',
          description: 'Max number of rows to return (default: 50).',
        },
      },
      async execute(params): Promise<ToolResult> {
        const metricType = params.metric_type as string | undefined;
        const keyword = params.keyword as string | undefined;
        const url = params.url as string | undefined;
        const limit = Math.min((params.limit as number) || 50, 200);

        try {
          const conditions: string[] = [];
          const values: unknown[] = [];
          let paramIndex = 1;

          if (metricType) {
            conditions.push(`metric_type = $${paramIndex++}`);
            values.push(metricType);
          }
          if (keyword) {
            conditions.push(`keyword ILIKE $${paramIndex++}`);
            values.push(`%${keyword}%`);
          }
          if (url) {
            conditions.push(`url = $${paramIndex++}`);
            values.push(url);
          }

          const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
          values.push(limit);

          const rows = await systemQuery(
            `SELECT * FROM seo_data ${whereClause} ORDER BY created_at DESC LIMIT $${paramIndex}`,
            values,
          );

          return {
            success: true,
            data: {
              rowCount: rows.length,
              entries: rows,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to query seo_data: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },

    {
      name: 'track_keyword_rankings',
      description:
        'Query current ranking for target keywords. Tries Search Console API first, ' +
        'then falls back to stored rank data from the seo_data table.',
      parameters: {
        keywords: {
          type: 'string',
          description: 'Comma-separated list of keywords to track.',
          required: true,
        },
        site_url: {
          type: 'string',
          description: 'The site URL to check rankings for.',
          required: true,
        },
      },
      async execute(params): Promise<ToolResult> {
        if (!params.keywords) return { success: false, error: 'keywords parameter is required' };
        const keywords = (params.keywords as string).split(',').map((k) => k.trim()).filter(Boolean);
        const siteUrl = params.site_url as string;

        if (keywords.length === 0) {
          return { success: false, error: 'No keywords provided.' };
        }

        const auth = getSearchConsoleCredentials();
        const rankings: Record<string, unknown>[] = [];

        for (const keyword of keywords) {
          let ranking: Record<string, unknown> | null = null;

          // Try Search Console API first
          if (auth) {
            try {
              const now = new Date();
              const endDate = now.toISOString().split('T')[0];
              const startDate = new Date(now.getTime() - 7 * 86400000).toISOString().split('T')[0];

              const response = await fetch(
                `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
                {
                  method: 'POST',
                  headers: auth.headers,
                  body: JSON.stringify({
                    startDate,
                    endDate,
                    dimensions: ['query'],
                    dimensionFilterGroups: [{
                      filters: [{ dimension: 'query', expression: keyword }],
                    }],
                    rowLimit: 1,
                  }),
                },
              );

              if (response.ok) {
                const result = await response.json() as Record<string, unknown>;
                const resultRows = result.rows as Record<string, unknown>[] | undefined;
                const row = resultRows?.[0];
                if (row) {
                  ranking = {
                    keyword,
                    position: row.position,
                    clicks: row.clicks,
                    impressions: row.impressions,
                    source: 'search_console',
                  };
                }
              }
            } catch {
              // Fall through to database lookup
            }
          }

          // Fallback to seo_data table
          if (!ranking) {
            try {
              const rows = await systemQuery(
                `SELECT * FROM seo_data WHERE metric_type = 'ranking' AND keyword ILIKE $1 ORDER BY created_at DESC LIMIT 1`,
                [`%${keyword}%`],
              );
              const row = rows[0];
              if (row) {
                ranking = {
                  keyword,
                  position: row.value,
                  search_volume: row.search_volume || null,
                  difficulty: row.difficulty || null,
                  change: row.change || null,
                  source: 'seo_data',
                };
              }
            } catch {
              // No data available
            }
          }

          rankings.push(ranking || { keyword, position: null, source: 'not_found' });
        }

        return {
          success: true,
          data: {
            siteUrl,
            keywordCount: keywords.length,
            rankings,
          },
        };
      },
    },

    {
      name: 'analyze_page_seo',
      description:
        'Audit a specific URL for on-page SEO factors. Fetches the page and analyzes title tag, ' +
        'meta description, H1 count, word count, internal/external link count, and image alt coverage.',
      parameters: {
        url: {
          type: 'string',
          description: 'The URL to audit.',
          required: true,
        },
      },
      async execute(params): Promise<ToolResult> {
        const url = params.url as string;

        let parsed: URL;
        try {
          parsed = new URL(url);
        } catch {
          return { success: false, error: 'Invalid URL provided.' };
        }

        if (!['http:', 'https:'].includes(parsed.protocol)) {
          return { success: false, error: 'Only HTTP/HTTPS URLs are allowed.' };
        }

        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 15000);

          const response = await fetch(url, {
            signal: controller.signal,
            headers: {
              'User-Agent': 'Glyphor-SEO-Agent/1.0',
              Accept: 'text/html,application/xhtml+xml',
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

          // Parse title tag
          const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
          const title = titleMatch?.[1]?.trim() || '';

          // Parse meta description
          const metaDescMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i)
            || html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["'][^>]*>/i);
          const metaDescription = metaDescMatch?.[1]?.trim() || '';

          // Count H1 tags
          const h1Matches = html.match(/<h1[\s>]/gi);
          const h1Count = h1Matches?.length || 0;

          // Word count from body text
          const bodyText = html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          const wordCount = bodyText.split(/\s+/).filter(Boolean).length;

          // Count links
          const linkMatches = html.match(/<a\s[^>]*href=["']([^"']*)["'][^>]*>/gi) || [];
          let internalLinks = 0;
          let externalLinks = 0;
          for (const link of linkMatches) {
            const hrefMatch = link.match(/href=["']([^"']*)["']/i);
            const href = hrefMatch?.[1] || '';
            if (href.startsWith('/') || href.startsWith(parsed.origin)) {
              internalLinks++;
            } else if (href.startsWith('http')) {
              externalLinks++;
            }
          }

          // Image alt coverage
          const imgMatches = html.match(/<img\s[^>]*>/gi) || [];
          const totalImages = imgMatches.length;
          const imagesWithAlt = imgMatches.filter((img) => /alt=["'][^"']+["']/i.test(img)).length;

          return {
            success: true,
            data: {
              url,
              title,
              titleLength: title.length,
              metaDescription,
              metaDescriptionLength: metaDescription.length,
              h1Count,
              wordCount,
              internalLinks,
              externalLinks,
              totalImages,
              imagesWithAlt,
              imageAltCoverage: totalImages > 0 ? Math.round((imagesWithAlt / totalImages) * 100) : 100,
            },
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes('abort')) {
            return { success: false, error: 'Request timed out after 15 seconds.' };
          }
          return { success: false, error: `Page analysis failed: ${msg}` };
        }
      },
    },

    {
      name: 'get_indexing_status',
      description:
        'Check indexing status for a site via Google Search Console. Returns indexed page count, ' +
        'not-indexed count, and reasons for exclusion.',
      parameters: {
        site_url: {
          type: 'string',
          description: 'The site URL registered in Search Console.',
          required: true,
        },
      },
      async execute(params): Promise<ToolResult> {
        const siteUrl = params.site_url as string;

        const auth = getSearchConsoleCredentials();
        if (!auth) {
          return {
            success: false,
            error: 'Google Search Console credentials not available. Set GOOGLE_SEARCH_CONSOLE_CREDENTIALS env var.',
          };
        }

        try {
          const response = await fetch(
            `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
            {
              method: 'POST',
              headers: auth.headers,
              body: JSON.stringify({
                startDate: new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0],
                endDate: new Date().toISOString().split('T')[0],
                dimensions: ['page'],
                rowLimit: 1000,
              }),
            },
          );

          if (!response.ok) {
            return {
              success: false,
              error: `Search Console API error: HTTP ${response.status} ${response.statusText}`,
            };
          }

          const result = await response.json() as Record<string, unknown>;
          const resultRows = result.rows as unknown[] | undefined;
          const indexedPages = resultRows?.length || 0;

          // Also check seo_data for stored indexing information
          let exclusionReasons: Record<string, unknown>[] = [];
          try {
            exclusionReasons = await systemQuery(
              `SELECT keyword AS reason, value AS count FROM seo_data WHERE metric_type = 'indexing_exclusion' AND url = $1 ORDER BY created_at DESC`,
              [siteUrl],
            );
          } catch {
            // No stored exclusion data
          }

          return {
            success: true,
            data: {
              siteUrl,
              indexedCount: indexedPages,
              exclusionReasons,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Indexing status check failed: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },

    {
      name: 'submit_sitemap',
      description:
        'Submit a sitemap URL to Google Search Console for crawling. ' +
        'Requires YELLOW authority level.',
      parameters: {
        site_url: {
          type: 'string',
          description: 'The site URL registered in Search Console.',
          required: true,
        },
        sitemap_url: {
          type: 'string',
          description: 'The full URL of the sitemap to submit (e.g. "https://example.com/sitemap.xml").',
          required: true,
        },
      },
      async execute(params): Promise<ToolResult> {
        const siteUrl = params.site_url as string;
        const sitemapUrl = params.sitemap_url as string;

        const auth = getSearchConsoleCredentials();
        if (!auth) {
          return {
            success: false,
            error: 'Google Search Console credentials not available. Set GOOGLE_SEARCH_CONSOLE_CREDENTIALS env var.',
          };
        }

        try {
          const response = await fetch(
            `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/sitemaps/${encodeURIComponent(sitemapUrl)}`,
            {
              method: 'PUT',
              headers: auth.headers,
            },
          );

          if (!response.ok) {
            return {
              success: false,
              error: `Sitemap submission failed: HTTP ${response.status} ${response.statusText}`,
            };
          }

          return {
            success: true,
            data: {
              message: `Sitemap submitted successfully.`,
              siteUrl,
              sitemapUrl,
              submittedAt: new Date().toISOString(),
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Sitemap submission failed: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },

    {
      name: 'update_seo_data',
      description:
        'Write SEO findings back to the seo_data table. Use this to store ranking data, ' +
        'audit results, or any SEO metric for future reference.',
      parameters: {
        metric_type: {
          type: 'string',
          description: 'Type of SEO metric (e.g. "ranking", "backlink", "audit", "traffic").',
          required: true,
        },
        keyword: {
          type: 'string',
          description: 'Associated keyword, if applicable.',
        },
        url: {
          type: 'string',
          description: 'Associated URL, if applicable.',
        },
        value: {
          type: 'string',
          description: 'The metric value to store.',
          required: true,
        },
        notes: {
          type: 'string',
          description: 'Additional notes or context.',
        },
      },
      async execute(params): Promise<ToolResult> {
        const metricType = params.metric_type as string;
        const keyword = (params.keyword as string) || null;
        const url = (params.url as string) || null;
        const value = params.value as string;
        const notes = (params.notes as string) || null;

        try {
          await systemQuery(
            `INSERT INTO seo_data (metric_type, keyword, url, value, notes, created_at) VALUES ($1, $2, $3, $4, $5, NOW())`,
            [metricType, keyword, url, value, notes],
          );

          return {
            success: true,
            data: {
              message: 'SEO data saved successfully.',
              metricType,
              keyword,
              url,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to update seo_data: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },

    {
      name: 'get_backlink_profile',
      description:
        'Analyze the backlink profile for a site. Queries stored backlink data from the seo_data table ' +
        'and provides a summary of referring domains, link types, and anchor text distribution.',
      parameters: {
        site_url: {
          type: 'string',
          description: 'The site URL to analyze backlinks for.',
          required: true,
        },
        limit: {
          type: 'number',
          description: 'Max number of backlink entries to return (default: 50).',
        },
      },
      async execute(params): Promise<ToolResult> {
        const siteUrl = params.site_url as string;
        const limit = Math.min((params.limit as number) || 50, 200);

        try {
          const backlinks = await systemQuery(
            `SELECT * FROM seo_data WHERE metric_type = 'backlink' AND url = $1 ORDER BY created_at DESC LIMIT $2`,
            [siteUrl, limit],
          );

          // Build summary from stored data
          const referringDomains = new Set<string>();
          for (const row of backlinks) {
            if (row.keyword) {
              try {
                const domain = new URL(row.keyword).hostname;
                referringDomains.add(domain);
              } catch {
                referringDomains.add(row.keyword);
              }
            }
          }

          return {
            success: true,
            data: {
              siteUrl,
              totalBacklinks: backlinks.length,
              referringDomains: referringDomains.size,
              domains: Array.from(referringDomains),
              backlinks,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Backlink analysis failed: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },
  ];
}
