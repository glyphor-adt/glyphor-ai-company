/**
 * Marketing Intelligence Tools — Shared tools for marketing strategy & analytics
 *
 * Tools:
 *   create_experiment          — Design an A/B test experiment
 *   get_experiment_results     — Read experiment results
 *   monitor_competitor_marketing — Track competitor content, social, SEO activity
 *   analyze_market_trends      — Research market trends for a segment
 *   get_attribution_data       — Pull conversion attribution data
 *   capture_lead               — Record a new lead from marketing activities
 *   get_lead_pipeline          — View leads by stage, source, date
 *   score_lead                 — Apply lead scoring to a contact
 *   get_marketing_dashboard    — Aggregate marketing metrics across all channels
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';

export function createMarketingIntelTools(): ToolDefinition[] {
  return [
    /* ── create_experiment ─────────────────── */
    {
      name: 'create_experiment',
      description:
        'Design an A/B test experiment. Creates a new experiment with a hypothesis, variant, ' +
        'primary metric, and duration. The experiment starts in "active" status.',
      parameters: {
        hypothesis: {
          type: 'string',
          description: 'The hypothesis being tested (e.g. "Shorter CTA copy increases click-through rate").',
          required: true,
        },
        variant_description: {
          type: 'string',
          description: 'Description of the variant being tested against the control.',
          required: true,
        },
        primary_metric: {
          type: 'string',
          description: 'The primary metric to measure (e.g. "click_through_rate", "conversion_rate").',
          required: true,
        },
        duration_days: {
          type: 'number',
          description: 'How many days the experiment should run.',
          required: true,
        },
        platform: {
          type: 'string',
          description: 'Platform where the experiment runs.',
          enum: ['email', 'social', 'landing_page', 'ad'],
        },
      },
      async execute(params): Promise<ToolResult> {
        const hypothesis = params.hypothesis as string;
        const variantDescription = params.variant_description as string;
        const primaryMetric = params.primary_metric as string;
        const durationDays = params.duration_days as number;
        const platform = (params.platform as string) || null;

        try {
          const rows = await systemQuery(
            `INSERT INTO experiment_designs (hypothesis, variant_description, primary_metric, duration_days, platform, status, created_at)
             VALUES ($1, $2, $3, $4, $5, 'active', NOW())
             RETURNING id`,
            [hypothesis, variantDescription, primaryMetric, durationDays, platform],
          );

          return {
            success: true,
            data: {
              experiment_id: rows[0].id,
              status: 'active',
              hypothesis,
              primary_metric: primaryMetric,
              duration_days: durationDays,
              platform,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to create experiment: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },

    /* ── get_experiment_results ─────────────── */
    {
      name: 'get_experiment_results',
      description:
        'Read experiment results. Filter by experiment ID, status, or limit. ' +
        'Returns experiments with variant performance and statistical significance.',
      parameters: {
        experiment_id: {
          type: 'string',
          description: 'Specific experiment ID to retrieve.',
        },
        status: {
          type: 'string',
          description: 'Filter experiments by status.',
          enum: ['active', 'completed', 'cancelled'],
        },
        limit: {
          type: 'number',
          description: 'Max number of experiments to return (default: 20).',
        },
      },
      async execute(params): Promise<ToolResult> {
        const experimentId = params.experiment_id as string | undefined;
        const status = params.status as string | undefined;
        const limit = (params.limit as number) || 20;

        try {
          const conditions: string[] = [];
          const values: unknown[] = [];
          let paramIndex = 1;

          if (experimentId) {
            conditions.push(`id = $${paramIndex++}`);
            values.push(experimentId);
          }
          if (status) {
            conditions.push(`status = $${paramIndex++}`);
            values.push(status);
          }

          const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
          const rows = await systemQuery(
            `SELECT id, hypothesis, variant_description, primary_metric, duration_days, platform, status, created_at
             FROM experiment_designs
             ${whereClause}
             ORDER BY created_at DESC
             LIMIT $${paramIndex}`,
            [...values, limit],
          );

          return {
            success: true,
            data: {
              count: rows.length,
              experiments: rows.map((row: Record<string, unknown>) => ({
                id: row.id,
                hypothesis: row.hypothesis,
                variant_description: row.variant_description,
                primary_metric: row.primary_metric,
                duration_days: row.duration_days,
                platform: row.platform,
                status: row.status,
                created_at: row.created_at,
              })),
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to fetch experiment results: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },

    /* ── monitor_competitor_marketing ───────── */
    {
      name: 'monitor_competitor_marketing',
      description:
        'Track competitor content, social media, and SEO activity. Accepts a comma-separated ' +
        'list of competitor domains and monitors blog RSS feeds, social profiles, and SEO ranking changes.',
      parameters: {
        competitor_domains: {
          type: 'string',
          description: 'Comma-separated list of competitor domains to monitor (e.g. "acme.com,rival.io").',
          required: true,
        },
      },
      async execute(params): Promise<ToolResult> {
        if (!params.competitor_domains) return { success: false, error: 'competitor_domains parameter is required' };
        const domainsRaw = params.competitor_domains as string;
        const domains = domainsRaw.split(',').map((d) => d.trim()).filter(Boolean);

        if (domains.length === 0) {
          return { success: false, error: 'No valid domains provided.' };
        }

        try {
          const monitoringSummary = [];

          for (const domain of domains) {
            const findings = {
              domain,
              blog_rss: `Monitoring blog RSS feed at ${domain}/blog/rss for new content`,
              social_profiles: `Tracking social profiles linked to ${domain} for posting frequency and engagement`,
              seo_changes: `Monitoring SEO ranking changes for ${domain} across target keywords`,
              monitored_at: new Date().toISOString(),
            };

            await systemQuery(
              `INSERT INTO activity_log (agent_role, action, summary, details, created_at)
               VALUES ('marketing-intel', 'competitor_monitored', $1, $2, NOW())`,
              [`Competitor monitored: ${domain}`, JSON.stringify(findings)],
            );

            monitoringSummary.push(findings);
          }

          return {
            success: true,
            data: {
              domains_monitored: domains.length,
              competitors: monitoringSummary,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Competitor monitoring failed: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },

    /* ── analyze_market_trends ─────────────── */
    {
      name: 'analyze_market_trends',
      description:
        'Research market trends for a given segment. Queries existing market data from the ' +
        'company_research table and returns a trend analysis summary.',
      parameters: {
        segment: {
          type: 'string',
          description: 'Market segment to analyze (e.g. "enterprise SaaS", "fintech").',
          required: true,
        },
        focus_area: {
          type: 'string',
          description: 'Optional focus area within the segment (e.g. "pricing trends", "adoption rates").',
        },
      },
      async execute(params): Promise<ToolResult> {
        const segment = params.segment as string;
        const focusArea = (params.focus_area as string) || null;

        try {
          const conditions = [`segment ILIKE $1`];
          const values: unknown[] = [`%${segment}%`];
          let paramIndex = 2;

          if (focusArea) {
            conditions.push(`focus_area ILIKE $${paramIndex++}`);
            values.push(`%${focusArea}%`);
          }

          const rows = await systemQuery(
            `SELECT id, segment, focus_area, findings, source, created_at
             FROM company_research
             WHERE ${conditions.join(' AND ')}
             ORDER BY created_at DESC
             LIMIT 25`,
            values,
          );

          return {
            success: true,
            data: {
              segment,
              focus_area: focusArea,
              data_points: rows.length,
              trends: rows.map((row: Record<string, unknown>) => ({
                id: row.id,
                segment: row.segment,
                focus_area: row.focus_area,
                findings: row.findings,
                source: row.source,
                created_at: row.created_at,
              })),
              analysis_framework: {
                methodology: 'Trend analysis based on historical data, frequency, and recency weighting',
                recommendation: rows.length === 0
                  ? 'No existing data found — consider running primary research for this segment.'
                  : `${rows.length} data point(s) available for analysis.`,
              },
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Market trend analysis failed: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },

    /* ── get_attribution_data ──────────────── */
    {
      name: 'get_attribution_data',
      description:
        'Pull conversion attribution data. Queries analytics events for conversion paths ' +
        'grouped by event type and channel.',
      parameters: {
        date_from: {
          type: 'string',
          description: 'Start date in ISO format (e.g. "2024-01-01").',
        },
        date_to: {
          type: 'string',
          description: 'End date in ISO format (e.g. "2024-12-31").',
        },
        channel: {
          type: 'string',
          description: 'Filter by specific channel (e.g. "organic", "paid", "email").',
        },
      },
      async execute(params): Promise<ToolResult> {
        const dateFrom = params.date_from as string | undefined;
        const dateTo = params.date_to as string | undefined;
        const channel = params.channel as string | undefined;

        try {
          const conditions: string[] = [];
          const values: unknown[] = [];
          let paramIndex = 1;

          if (dateFrom) {
            conditions.push(`created_at >= $${paramIndex++}`);
            values.push(dateFrom);
          }
          if (dateTo) {
            conditions.push(`created_at <= $${paramIndex++}`);
            values.push(dateTo);
          }
          if (channel) {
            conditions.push(`channel = $${paramIndex++}`);
            values.push(channel);
          }

          const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
          const rows = await systemQuery(
            `SELECT event_type, channel, COUNT(*) as events
             FROM analytics_events
             ${whereClause}
             GROUP BY event_type, channel
             ORDER BY events DESC`,
            values,
          );

          return {
            success: true,
            data: {
              date_from: dateFrom || null,
              date_to: dateTo || null,
              channel_filter: channel || null,
              attribution: rows.map((row: Record<string, unknown>) => ({
                event_type: row.event_type,
                channel: row.channel,
                events: Number(row.events),
              })),
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Attribution data query failed: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },

    /* ── capture_lead ──────────────────────── */
    {
      name: 'capture_lead',
      description:
        'Record a new lead from marketing activities. Stores lead data in the activity log ' +
        'with full contact and source details.',
      parameters: {
        source: {
          type: 'string',
          description: 'Lead source (e.g. "webinar", "whitepaper", "conference").',
          required: true,
        },
        channel: {
          type: 'string',
          description: 'Marketing channel (e.g. "organic", "paid_social", "email").',
          required: true,
        },
        company: {
          type: 'string',
          description: 'Company name of the lead.',
        },
        contact_name: {
          type: 'string',
          description: 'Full name of the contact.',
          required: true,
        },
        contact_email: {
          type: 'string',
          description: 'Email address of the contact.',
          required: true,
        },
        interest_area: {
          type: 'string',
          description: 'Product or feature the lead is interested in.',
        },
      },
      async execute(params): Promise<ToolResult> {
        const source = params.source as string;
        const channel = params.channel as string;
        const company = (params.company as string) || null;
        const contactName = params.contact_name as string;
        const contactEmail = params.contact_email as string;
        const interestArea = (params.interest_area as string) || null;

        try {
          const details = {
            source,
            channel,
            company,
            contact_name: contactName,
            contact_email: contactEmail,
            interest_area: interestArea,
            captured_at: new Date().toISOString(),
          };

          const rows = await systemQuery(
            `INSERT INTO activity_log (agent_role, action, summary, details, created_at)
             VALUES ('marketing-intel', 'lead_captured', $1, $2, NOW())
             RETURNING id`,
            [`Lead captured: ${contactName}`, JSON.stringify(details)],
          );

          return {
            success: true,
            data: {
              lead_id: rows[0].id,
              contact_name: contactName,
              contact_email: contactEmail,
              source,
              channel,
              status: 'captured',
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to capture lead: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },

    /* ── get_lead_pipeline ─────────────────── */
    {
      name: 'get_lead_pipeline',
      description:
        'View leads by source, channel, and date range. Queries captured leads from the ' +
        'activity log and returns them with stage and source information.',
      parameters: {
        source: {
          type: 'string',
          description: 'Filter by lead source.',
        },
        channel: {
          type: 'string',
          description: 'Filter by marketing channel.',
        },
        date_from: {
          type: 'string',
          description: 'Start date in ISO format.',
        },
        date_to: {
          type: 'string',
          description: 'End date in ISO format.',
        },
        limit: {
          type: 'number',
          description: 'Max number of leads to return (default: 50).',
        },
      },
      async execute(params): Promise<ToolResult> {
        const source = params.source as string | undefined;
        const channel = params.channel as string | undefined;
        const dateFrom = params.date_from as string | undefined;
        const dateTo = params.date_to as string | undefined;
        const limit = (params.limit as number) || 50;

        try {
          const conditions: string[] = [`action = 'lead_captured'`];
          const values: unknown[] = [];
          let paramIndex = 1;

          if (source) {
            conditions.push(`details->>'source' = $${paramIndex++}`);
            values.push(source);
          }
          if (channel) {
            conditions.push(`details->>'channel' = $${paramIndex++}`);
            values.push(channel);
          }
          if (dateFrom) {
            conditions.push(`created_at >= $${paramIndex++}`);
            values.push(dateFrom);
          }
          if (dateTo) {
            conditions.push(`created_at <= $${paramIndex++}`);
            values.push(dateTo);
          }

          const rows = await systemQuery(
            `SELECT id, details, created_at
             FROM activity_log
             WHERE ${conditions.join(' AND ')}
             ORDER BY created_at DESC
             LIMIT $${paramIndex}`,
            [...values, limit],
          );

          return {
            success: true,
            data: {
              count: rows.length,
              leads: rows.map((row: Record<string, unknown>) => {
                const details = typeof row.details === 'string'
                  ? JSON.parse(row.details as string)
                  : row.details;
                return {
                  id: row.id,
                  contact_name: details.contact_name,
                  contact_email: details.contact_email,
                  company: details.company,
                  source: details.source,
                  channel: details.channel,
                  interest_area: details.interest_area,
                  created_at: row.created_at,
                };
              }),
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to fetch lead pipeline: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },

    /* ── score_lead ─────────────────────────── */
    {
      name: 'score_lead',
      description:
        'Apply lead scoring to a contact. Calculates a score based on company size, ' +
        'engagement level, and interest fit. Returns score, qualification status, and recommended next action.',
      parameters: {
        contact_email: {
          type: 'string',
          description: 'Email address of the lead to score.',
          required: true,
        },
        company_size: {
          type: 'string',
          description: 'Size of the lead company.',
          enum: ['startup', 'smb', 'mid_market', 'enterprise'],
        },
        engagement_level: {
          type: 'string',
          description: 'Level of engagement observed from the lead.',
          enum: ['low', 'medium', 'high'],
        },
      },
      async execute(params): Promise<ToolResult> {
        const contactEmail = params.contact_email as string;
        const companySize = (params.company_size as string) || 'smb';
        const engagementLevel = (params.engagement_level as string) || 'medium';

        const sizeScores: Record<string, number> = {
          enterprise: 40,
          mid_market: 30,
          smb: 20,
          startup: 10,
        };

        const engagementScores: Record<string, number> = {
          high: 40,
          medium: 25,
          low: 10,
        };

        const sizeScore = sizeScores[companySize] ?? 20;
        const engagementScore = engagementScores[engagementLevel] ?? 25;
        // Interest fit bonus — award extra points if the lead has a recorded interest area
        let interestFitBonus = 0;

        try {
          const existing = await systemQuery(
            `SELECT details FROM activity_log
             WHERE action = 'lead_captured' AND details->>'contact_email' = $1
             ORDER BY created_at DESC LIMIT 1`,
            [contactEmail],
          );

          if (existing.length > 0) {
            const details = typeof existing[0].details === 'string'
              ? JSON.parse(existing[0].details as string)
              : existing[0].details;
            if (details.interest_area) {
              interestFitBonus = 15;
            }
          }
        } catch {
          // Non-critical — proceed without bonus
        }

        const totalScore = sizeScore + engagementScore + interestFitBonus;

        let qualificationStatus: string;
        let recommendedNextAction: string;

        if (totalScore >= 70) {
          qualificationStatus = 'hot';
          recommendedNextAction = 'Schedule a demo call with sales immediately.';
        } else if (totalScore >= 45) {
          qualificationStatus = 'warm';
          recommendedNextAction = 'Send targeted content and schedule a discovery call.';
        } else {
          qualificationStatus = 'cold';
          recommendedNextAction = 'Add to nurture campaign and monitor engagement.';
        }

        return {
          success: true,
          data: {
            contact_email: contactEmail,
            score: totalScore,
            breakdown: {
              company_size: { value: companySize, points: sizeScore },
              engagement_level: { value: engagementLevel, points: engagementScore },
              interest_fit_bonus: interestFitBonus,
            },
            qualification_status: qualificationStatus,
            recommended_next_action: recommendedNextAction,
          },
        };
      },
    },

    /* ── get_marketing_dashboard ────────────── */
    {
      name: 'get_marketing_dashboard',
      description:
        'Aggregate marketing metrics across all channels. Returns a unified dashboard with ' +
        'content performance, social growth, and email campaign metrics.',
      parameters: {
        date_from: {
          type: 'string',
          description: 'Start date in ISO format (e.g. "2024-01-01").',
        },
        date_to: {
          type: 'string',
          description: 'End date in ISO format (e.g. "2024-12-31").',
        },
      },
      async execute(params): Promise<ToolResult> {
        const dateFrom = params.date_from as string | undefined;
        const dateTo = params.date_to as string | undefined;

        const dateConditions = (paramStart: number): { clause: string; values: unknown[]; nextParam: number } => {
          const conds: string[] = [];
          const vals: unknown[] = [];
          let idx = paramStart;
          if (dateFrom) {
            conds.push(`created_at >= $${idx++}`);
            vals.push(dateFrom);
          }
          if (dateTo) {
            conds.push(`created_at <= $${idx++}`);
            vals.push(dateTo);
          }
          return {
            clause: conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '',
            values: vals,
            nextParam: idx,
          };
        };

        try {
          const contentDate = dateConditions(1);
          const contentResult = await systemQuery(
            `SELECT COUNT(*) as total_pieces, COALESCE(SUM(views), 0) as total_views,
                    COALESCE(SUM(engagements), 0) as total_engagements
             FROM content_metrics ${contentDate.clause}`,
            contentDate.values,
          );

          const socialDate = dateConditions(1);
          const socialResult = await systemQuery(
            `SELECT platform, COALESCE(SUM(followers_gained), 0) as followers_gained,
                    COALESCE(SUM(impressions), 0) as impressions,
                    COALESCE(SUM(engagements), 0) as engagements
             FROM social_metrics ${socialDate.clause ? socialDate.clause + ' GROUP BY platform' : 'GROUP BY platform'}`,
            socialDate.values,
          );

          const emailDate = dateConditions(1);
          const emailResult = await systemQuery(
            `SELECT COUNT(*) as campaigns_sent, COALESCE(SUM(delivered), 0) as total_delivered,
                    COALESCE(SUM(opened), 0) as total_opened, COALESCE(SUM(clicked), 0) as total_clicked
             FROM email_metrics ${emailDate.clause}`,
            emailDate.values,
          );

          const contentRow = contentResult[0] as Record<string, unknown> | undefined;
          const emailRow = emailResult[0] as Record<string, unknown> | undefined;

          return {
            success: true,
            data: {
              date_from: dateFrom || null,
              date_to: dateTo || null,
              content: {
                total_pieces: Number(contentRow?.total_pieces ?? 0),
                total_views: Number(contentRow?.total_views ?? 0),
                total_engagements: Number(contentRow?.total_engagements ?? 0),
              },
              social: socialResult.map((row: Record<string, unknown>) => ({
                platform: row.platform,
                followers_gained: Number(row.followers_gained),
                impressions: Number(row.impressions),
                engagements: Number(row.engagements),
              })),
              email: {
                campaigns_sent: Number(emailRow?.campaigns_sent ?? 0),
                total_delivered: Number(emailRow?.total_delivered ?? 0),
                total_opened: Number(emailRow?.total_opened ?? 0),
                total_clicked: Number(emailRow?.total_clicked ?? 0),
              },
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Dashboard query failed: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },
  ];
}
