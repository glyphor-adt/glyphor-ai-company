/**
 * Competitive Intelligence Tools — Shared tools for tracking, comparing,
 * and analysing competitors across the market landscape.
 *
 * Tools:
 *   track_competitor           — Set up ongoing monitoring for a competitor
 *   get_competitor_profile     — Read compiled intelligence on a competitor
 *   update_competitor_profile  — Add new intelligence to a competitor
 *   compare_features           — Feature comparison between Glyphor and a competitor
 *   track_competitor_pricing   — Monitor competitor pricing changes
 *   monitor_competitor_launches — Track competitor product launches
 *   get_market_landscape       — High-level market map
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';

export function createCompetitiveIntelTools(): ToolDefinition[] {
  return [
    /* ── track_competitor ──────────────────── */
    {
      name: 'track_competitor',
      description:
        'Set up ongoing monitoring for a competitor. Creates a competitor_tracking entry in ' +
        'company_research with the competitor domain, products to watch, and social profiles.',
      parameters: {
        company_name: {
          type: 'string',
          description: 'Name of the competitor company to track.',
          required: true,
        },
        domain: {
          type: 'string',
          description: 'Primary domain of the competitor (e.g. "acme.com").',
          required: true,
        },
        products_to_track: {
          type: 'string',
          description: 'Comma-separated list of products to monitor (e.g. "ProductA,ProductB").',
        },
        social_profiles: {
          type: 'string',
          description: 'Comma-separated social profile URLs or handles to monitor.',
        },
      },
      async execute(params): Promise<ToolResult> {
        const companyName = params.company_name as string;
        const domain = params.domain as string;
        const productsToTrack = params.products_to_track as string | undefined;
        const socialProfiles = params.social_profiles as string | undefined;

        try {
          const details = {
            domain,
            products_to_track: productsToTrack
              ? productsToTrack.split(',').map((p) => p.trim()).filter(Boolean)
              : [],
            social_profiles: socialProfiles
              ? socialProfiles.split(',').map((s) => s.trim()).filter(Boolean)
              : [],
            tracking_started: new Date().toISOString(),
          };

          const rows = await systemQuery(
            `INSERT INTO company_research (company_name, category, details, created_at)
             VALUES ($1, 'competitor_tracking', $2, NOW())
             RETURNING id`,
            [companyName, JSON.stringify(details)],
          );

          return {
            success: true,
            data: {
              competitor_id: rows[0].id,
              company_name: companyName,
              domain,
              products_tracked: details.products_to_track,
              social_profiles: details.social_profiles,
              status: 'tracking_active',
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to track competitor: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },

    /* ── get_competitor_profile ─────────────── */
    {
      name: 'get_competitor_profile',
      description:
        'Read compiled intelligence on a competitor. Returns all intelligence entries ' +
        'stored in company_research for the given company name.',
      parameters: {
        company_name: {
          type: 'string',
          description: 'Name of the competitor to look up (case-insensitive match).',
          required: true,
        },
      },
      async execute(params): Promise<ToolResult> {
        const companyName = params.company_name as string;

        try {
          const rows = await systemQuery(
            `SELECT id, company_name, category, details, created_at
             FROM company_research
             WHERE company_name ILIKE $1
             ORDER BY created_at DESC`,
            [`%${companyName}%`],
          );

          if (rows.length === 0) {
            return {
              success: true,
              data: {
                company_name: companyName,
                entries: [],
                message: 'No intelligence entries found for this competitor.',
              },
            };
          }

          return {
            success: true,
            data: {
              company_name: companyName,
              entry_count: rows.length,
              entries: rows.map((row: Record<string, unknown>) => ({
                id: row.id,
                company_name: row.company_name,
                category: row.category,
                details: typeof row.details === 'string'
                  ? JSON.parse(row.details as string)
                  : row.details,
                created_at: row.created_at,
              })),
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to fetch competitor profile: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },

    /* ── update_competitor_profile ──────────── */
    {
      name: 'update_competitor_profile',
      description:
        'Add new intelligence to a competitor profile. Inserts a new entry into ' +
        'company_research with the specified source, content, and category.',
      parameters: {
        company_name: {
          type: 'string',
          description: 'Name of the competitor to update.',
          required: true,
        },
        source: {
          type: 'string',
          description: 'Where this intelligence came from (e.g. "TechCrunch article", "pricing page").',
          required: true,
        },
        content: {
          type: 'string',
          description: 'The intelligence content or summary to record.',
          required: true,
        },
        category: {
          type: 'string',
          description: 'Category of the intelligence.',
          required: true,
          enum: ['product', 'pricing', 'funding', 'hiring', 'partnership'],
        },
      },
      async execute(params): Promise<ToolResult> {
        const companyName = params.company_name as string;
        const source = params.source as string;
        const content = params.content as string;
        const category = params.category as string;

        try {
          const details = {
            source,
            content,
            recorded_at: new Date().toISOString(),
          };

          const rows = await systemQuery(
            `INSERT INTO company_research (company_name, category, details, created_at)
             VALUES ($1, $2, $3, NOW())
             RETURNING id`,
            [companyName, category, JSON.stringify(details)],
          );

          return {
            success: true,
            data: {
              entry_id: rows[0].id,
              company_name: companyName,
              category,
              source,
              status: 'recorded',
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to update competitor profile: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },

    /* ── compare_features ──────────────────── */
    {
      name: 'compare_features',
      description:
        'Feature comparison between Glyphor and a competitor. Queries stored product ' +
        'intelligence and returns a feature matrix with gap analysis.',
      parameters: {
        competitor: {
          type: 'string',
          description: 'Name of the competitor to compare against.',
          required: true,
        },
        product: {
          type: 'string',
          description: 'Which Glyphor internal engine to compare (these are internal capabilities, not external products).',
          required: true,
          enum: ['company'],
        },
      },
      async execute(params): Promise<ToolResult> {
        const competitor = params.competitor as string;
        const product = params.product as string;

        try {
          const rows = await systemQuery(
            `SELECT id, company_name, category, details, created_at
             FROM company_research
             WHERE company_name ILIKE $1
               AND category = 'product'
             ORDER BY created_at DESC`,
            [`%${competitor}%`],
          );

          const features = rows.map((row: Record<string, unknown>) => {
            const details = typeof row.details === 'string'
              ? JSON.parse(row.details as string)
              : row.details;
            return {
              id: row.id,
              content: details.content || details,
              source: details.source || null,
              recorded_at: details.recorded_at || row.created_at,
            };
          });

          return {
            success: true,
            data: {
              glyphor_product: product,
              competitor,
              competitor_feature_count: features.length,
              competitor_features: features,
              gap_analysis: {
                methodology: 'Based on recorded product intelligence entries for the competitor',
                recommendation: features.length === 0
                  ? 'No product intelligence found — add competitor product data with update_competitor_profile first.'
                  : `${features.length} product data point(s) available for comparison against ${product}.`,
              },
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Feature comparison failed: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },

    /* ── track_competitor_pricing ───────────── */
    {
      name: 'track_competitor_pricing',
      description:
        'Monitor competitor pricing changes. Returns pricing history from stored ' +
        'intelligence entries categorised as pricing.',
      parameters: {
        competitor: {
          type: 'string',
          description: 'Name of the competitor whose pricing to track.',
          required: true,
        },
      },
      async execute(params): Promise<ToolResult> {
        const competitor = params.competitor as string;

        try {
          const rows = await systemQuery(
            `SELECT id, company_name, details, created_at
             FROM company_research
             WHERE company_name ILIKE $1
               AND category = 'pricing'
             ORDER BY created_at DESC`,
            [`%${competitor}%`],
          );

          const pricingHistory = rows.map((row: Record<string, unknown>) => {
            const details = typeof row.details === 'string'
              ? JSON.parse(row.details as string)
              : row.details;
            return {
              id: row.id,
              content: details.content || details,
              source: details.source || null,
              recorded_at: details.recorded_at || row.created_at,
            };
          });

          return {
            success: true,
            data: {
              competitor,
              pricing_entries: pricingHistory.length,
              history: pricingHistory,
              summary: pricingHistory.length === 0
                ? 'No pricing data found — add pricing intelligence with update_competitor_profile.'
                : `${pricingHistory.length} pricing data point(s) on file.`,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Pricing tracking failed: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },

    /* ── monitor_competitor_launches ────────── */
    {
      name: 'monitor_competitor_launches',
      description:
        'Track competitor product launches and announcements. Queries product-category ' +
        'intelligence within a date range. Omit competitor to see launches across all tracked competitors.',
      parameters: {
        competitor: {
          type: 'string',
          description: 'Name of the competitor (optional — returns all competitors if omitted).',
        },
        date_range: {
          type: 'string',
          description: 'How far back to look for launches.',
          required: true,
          enum: ['7d', '30d', '90d'],
        },
      },
      async execute(params): Promise<ToolResult> {
        const competitor = params.competitor as string | undefined;
        const dateRange = params.date_range as string;

        const intervalMap: Record<string, string> = {
          '7d': '7 days',
          '30d': '30 days',
          '90d': '90 days',
        };
        const interval = intervalMap[dateRange] || '30 days';

        try {
          const conditions: string[] = [
            `category = 'product'`,
            `created_at >= NOW() - INTERVAL '${interval}'`,
          ];
          const values: unknown[] = [];
          let paramIndex = 1;

          if (competitor) {
            conditions.push(`company_name ILIKE $${paramIndex++}`);
            values.push(`%${competitor}%`);
          }

          const rows = await systemQuery(
            `SELECT id, company_name, details, created_at
             FROM company_research
             WHERE ${conditions.join(' AND ')}
             ORDER BY created_at DESC`,
            values,
          );

          const launches = rows.map((row: Record<string, unknown>) => {
            const details = typeof row.details === 'string'
              ? JSON.parse(row.details as string)
              : row.details;
            return {
              id: row.id,
              company_name: row.company_name,
              content: details.content || details,
              source: details.source || null,
              launched_at: details.recorded_at || row.created_at,
            };
          });

          return {
            success: true,
            data: {
              date_range: dateRange,
              competitor_filter: competitor || 'all',
              launch_count: launches.length,
              launches,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Launch monitoring failed: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },

    /* ── get_market_landscape ──────────────── */
    {
      name: 'get_market_landscape',
      description:
        'High-level market map. Aggregates all tracked competitors by category and returns ' +
        'a positioning analysis. Optionally filter by market segment.',
      parameters: {
        segment: {
          type: 'string',
          description: 'Market segment to filter by (optional — defaults to all).',
          enum: ['all', 'enterprise', 'smb', 'developer_tools'],
        },
      },
      async execute(params): Promise<ToolResult> {
        const segment = (params.segment as string) || 'all';

        try {
          const conditions: string[] = [];
          const values: unknown[] = [];
          let paramIndex = 1;

          if (segment !== 'all') {
            conditions.push(`details->>'segment' = $${paramIndex++}`);
            values.push(segment);
          }

          const whereClause = conditions.length > 0
            ? `WHERE ${conditions.join(' AND ')}`
            : '';

          const rows = await systemQuery(
            `SELECT company_name, category, COUNT(*) as entry_count
             FROM company_research
             ${whereClause}
             GROUP BY company_name, category
             ORDER BY company_name, entry_count DESC`,
            values,
          );

          // Group by company
          const competitorMap: Record<string, { categories: Record<string, number>; total: number }> = {};
          for (const row of rows as Array<Record<string, unknown>>) {
            const name = row.company_name as string;
            if (!competitorMap[name]) {
              competitorMap[name] = { categories: {}, total: 0 };
            }
            const count = Number(row.entry_count);
            competitorMap[name].categories[row.category as string] = count;
            competitorMap[name].total += count;
          }

          const competitors = Object.entries(competitorMap).map(([name, data]) => ({
            company_name: name,
            categories: data.categories,
            total_entries: data.total,
          }));

          return {
            success: true,
            data: {
              segment,
              competitor_count: competitors.length,
              competitors,
              positioning_analysis: {
                methodology: 'Aggregation of all intelligence entries grouped by competitor and category',
                recommendation: competitors.length === 0
                  ? 'No competitors tracked yet — use track_competitor to start monitoring.'
                  : `${competitors.length} competitor(s) in the landscape with ${rows.length} category grouping(s).`,
              },
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Market landscape query failed: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },
  ];
}
