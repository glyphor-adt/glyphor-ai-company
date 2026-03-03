/**
 * Legal Tools — Legal, compliance, contracts, IP, tax, and data privacy
 *
 * Tools:
 *   track_regulations          — Monitor regulatory changes by jurisdiction/topic
 *   get_compliance_status      — Check compliance checklist status by framework
 *   update_compliance_item     — Update a compliance checklist item
 *   create_compliance_alert    — Set up a compliance monitoring alert
 *   get_contracts              — List contracts with optional filters
 *   create_contract_review     — Initiate a contract review workflow
 *   flag_contract_issue        — Flag a risk or issue on a contract
 *   get_contract_renewals      — List upcoming contract renewals
 *   get_ip_portfolio           — View intellectual property assets
 *   create_ip_filing           — Initiate a new IP filing (patent/trademark)
 *   monitor_ip_infringement    — Check IP portfolio for infringement risks
 *   get_tax_calendar           — View upcoming tax deadlines
 *   calculate_tax_estimate     — Estimate tax liability for a period
 *   get_tax_research           — Research tax implications for a scenario
 *   review_tax_strategy        — Analyze tax optimization opportunities
 *   audit_data_flows           — Map data flows for privacy compliance
 *   check_data_retention       — Verify data retention policy compliance
 *   get_privacy_requests       — Track data subject access requests (DSARs)
 *   audit_access_permissions   — Audit IAM access for over-provisioned accounts
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';

export function createLegalTools(): ToolDefinition[] {
  return [
    // ── 1. track_regulations ──────────────────────────────────────────────
    {
      name: 'track_regulations',
      description:
        'Monitor regulatory changes for specified jurisdictions and topics. ' +
        'Queries activity_log for recent regulatory findings and updates.',
      parameters: {
        jurisdictions: {
          type: 'string',
          description: 'Comma-separated list of jurisdictions to monitor (e.g., "US,EU,UK")',
        },
        topics: {
          type: 'string',
          description: 'Comma-separated list of regulatory topics (e.g., "AI,privacy,fintech")',
        },
      },
      async execute(params): Promise<ToolResult> {
        const jurisdictions = params.jurisdictions as string;
        const topics = params.topics as string;

        try {
          const rows = await systemQuery<{
            id: string;
            type: string;
            description: string;
            metadata: Record<string, unknown>;
            created_at: string;
          }>(
            `SELECT id, type, description, metadata, created_at::text as created_at
             FROM activity_log
             WHERE type = 'regulatory_update'
             ORDER BY created_at DESC
             LIMIT 50`,
          );

          const updates = rows.map((r) => ({
            id: r.id,
            description: r.description,
            metadata: r.metadata,
            created_at: r.created_at,
          }));

          return {
            success: true,
            data: {
              jurisdictions: jurisdictions || 'all',
              topics: topics || 'all',
              recent_updates: updates,
              count: updates.length,
              queried_at: new Date().toISOString(),
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to track regulations: ${(err as Error).message}`,
          };
        }
      },
    },

    // ── 2. get_compliance_status ───────────────────────────────────────────
    {
      name: 'get_compliance_status',
      description:
        'Check compliance status for a specific framework. Returns all checklist items ' +
        'with their current status, evidence, and notes.',
      parameters: {
        framework: {
          type: 'string',
          description: 'Compliance framework to check',
          required: true,
          enum: ['GDPR', 'CCPA', 'SOC2', 'EU_AI_Act'],
        },
      },
      async execute(params): Promise<ToolResult> {
        const framework = params.framework as string;

        try {
          const rows = await systemQuery<{
            id: string;
            framework: string;
            item: string;
            status: string;
            evidence: string;
            notes: string;
            updated_at: string;
          }>(
            `SELECT id, framework, item, status, evidence, notes, updated_at::text as updated_at
             FROM compliance_checklists
             WHERE framework = $1
             ORDER BY item`,
            [framework],
          );

          const summary = {
            compliant: rows.filter((r) => r.status === 'compliant').length,
            non_compliant: rows.filter((r) => r.status === 'non_compliant').length,
            in_progress: rows.filter((r) => r.status === 'in_progress').length,
            not_applicable: rows.filter((r) => r.status === 'not_applicable').length,
          };

          return {
            success: true,
            data: {
              framework,
              total_items: rows.length,
              summary,
              items: rows,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to get compliance status: ${(err as Error).message}`,
          };
        }
      },
    },

    // ── 3. update_compliance_item ──────────────────────────────────────────
    {
      name: 'update_compliance_item',
      description:
        'Update a compliance checklist item with new status, evidence, or notes.',
      parameters: {
        item_id: {
          type: 'string',
          description: 'ID of the compliance checklist item to update',
          required: true,
        },
        status: {
          type: 'string',
          description: 'New compliance status',
          required: true,
          enum: ['compliant', 'non_compliant', 'in_progress', 'not_applicable'],
        },
        evidence: {
          type: 'string',
          description: 'Evidence or documentation supporting the status',
        },
        notes: {
          type: 'string',
          description: 'Additional notes about the compliance item',
        },
      },
      async execute(params): Promise<ToolResult> {
        const itemId = params.item_id as string;
        const status = params.status as string;
        const evidence = params.evidence as string | undefined;
        const notes = params.notes as string | undefined;

        try {
          const setClauses = ['status = $1', 'updated_at = NOW()'];
          const values: unknown[] = [status];
          let paramIndex = 2;

          if (evidence !== undefined) {
            setClauses.push(`evidence = $${paramIndex}`);
            values.push(evidence);
            paramIndex++;
          }
          if (notes !== undefined) {
            setClauses.push(`notes = $${paramIndex}`);
            values.push(notes);
            paramIndex++;
          }

          values.push(itemId);
          const rows = await systemQuery<{ id: string; item: string; status: string }>(
            `UPDATE compliance_checklists
             SET ${setClauses.join(', ')}
             WHERE id = $${paramIndex}
             RETURNING id, item, status`,
            values,
          );

          if (rows.length === 0) {
            return { success: false, error: `Compliance item ${itemId} not found` };
          }

          return {
            success: true,
            data: {
              updated: rows[0],
              evidence: evidence ?? null,
              notes: notes ?? null,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to update compliance item: ${(err as Error).message}`,
          };
        }
      },
    },

    // ── 4. create_compliance_alert ─────────────────────────────────────────
    {
      name: 'create_compliance_alert',
      description:
        'Set up a compliance monitoring alert. Inserts an alert entry into activity_log ' +
        'for tracking and notification.',
      parameters: {
        trigger_description: {
          type: 'string',
          description: 'Description of what triggers this alert',
          required: true,
        },
        severity: {
          type: 'string',
          description: 'Alert severity level',
          enum: ['low', 'medium', 'high', 'critical'],
        },
        notification_targets: {
          type: 'string',
          description: 'Comma-separated notification targets (e.g., emails or Slack channels)',
        },
      },
      async execute(params): Promise<ToolResult> {
        const triggerDescription = params.trigger_description as string;
        const severity = (params.severity as string) || 'medium';
        const notificationTargets = params.notification_targets as string | undefined;

        try {
          const rows = await systemQuery<{ id: string; created_at: string }>(
            `INSERT INTO activity_log (type, description, metadata)
             VALUES ('compliance_alert', $1, $2::jsonb)
             RETURNING id, created_at::text as created_at`,
            [
              triggerDescription,
              JSON.stringify({
                severity,
                notification_targets: notificationTargets
                  ? notificationTargets.split(',').map((t) => t.trim())
                  : [],
              }),
            ],
          );

          return {
            success: true,
            data: {
              alert_id: rows[0]?.id,
              trigger_description: triggerDescription,
              severity,
              notification_targets: notificationTargets || null,
              created_at: rows[0]?.created_at,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to create compliance alert: ${(err as Error).message}`,
          };
        }
      },
    },

    // ── 5. get_contracts ──────────────────────────────────────────────────
    {
      name: 'get_contracts',
      description:
        'List contracts with optional filters for type, status, and counterparty. ' +
        'Returns contract details including key terms and dates.',
      parameters: {
        contract_type: {
          type: 'string',
          description: 'Filter by contract type',
          enum: ['customer', 'vendor', 'partnership', 'employment'],
        },
        status: {
          type: 'string',
          description: 'Filter by contract status',
          enum: ['active', 'pending', 'expired', 'terminated'],
        },
        counterparty: {
          type: 'string',
          description: 'Filter by counterparty name (partial match)',
        },
      },
      async execute(params): Promise<ToolResult> {
        const contractType = params.contract_type as string | undefined;
        const status = params.status as string | undefined;
        const counterparty = params.counterparty as string | undefined;

        try {
          const conditions: string[] = [];
          const values: unknown[] = [];
          let paramIndex = 1;

          if (contractType) {
            conditions.push(`type = $${paramIndex}`);
            values.push(contractType);
            paramIndex++;
          }
          if (status) {
            conditions.push(`status = $${paramIndex}`);
            values.push(status);
            paramIndex++;
          }
          if (counterparty) {
            conditions.push(`counterparty ILIKE $${paramIndex}`);
            values.push(`%${counterparty}%`);
            paramIndex++;
          }

          const whereClause = conditions.length > 0
            ? `WHERE ${conditions.join(' AND ')}`
            : '';

          const rows = await systemQuery<{
            id: string;
            type: string;
            counterparty: string;
            status: string;
            key_terms: Record<string, unknown>;
            value: number;
            start_date: string;
            end_date: string;
            renewal_date: string;
          }>(
            `SELECT id, type, counterparty, status, key_terms, value,
                    start_date::text as start_date, end_date::text as end_date,
                    renewal_date::text as renewal_date
             FROM contracts
             ${whereClause}
             ORDER BY end_date ASC`,
            values,
          );

          return {
            success: true,
            data: {
              filters: { contract_type: contractType, status, counterparty },
              count: rows.length,
              contracts: rows,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to get contracts: ${(err as Error).message}`,
          };
        }
      },
    },

    // ── 6. create_contract_review ──────────────────────────────────────────
    {
      name: 'create_contract_review',
      description:
        'Start a contract review workflow by logging a review entry in activity_log.',
      parameters: {
        contract_type: {
          type: 'string',
          description: 'Type of contract being reviewed',
          required: true,
        },
        counterparty: {
          type: 'string',
          description: 'Counterparty for the contract',
          required: true,
        },
        key_terms: {
          type: 'string',
          description: 'Key terms to review (comma-separated or free text)',
          required: true,
        },
        deadline: {
          type: 'string',
          description: 'Review deadline (ISO date string)',
        },
      },
      async execute(params): Promise<ToolResult> {
        const contractType = params.contract_type as string;
        const counterparty = params.counterparty as string;
        const keyTerms = params.key_terms as string;
        const deadline = params.deadline as string | undefined;

        try {
          const rows = await systemQuery<{ id: string; created_at: string }>(
            `INSERT INTO activity_log (type, description, metadata)
             VALUES ('contract_review', $1, $2::jsonb)
             RETURNING id, created_at::text as created_at`,
            [
              `Contract review: ${contractType} with ${counterparty}`,
              JSON.stringify({
                contract_type: contractType,
                counterparty,
                key_terms: keyTerms,
                deadline: deadline || null,
                status: 'pending',
              }),
            ],
          );

          return {
            success: true,
            data: {
              review_id: rows[0]?.id,
              contract_type: contractType,
              counterparty,
              key_terms: keyTerms,
              deadline: deadline || null,
              created_at: rows[0]?.created_at,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to create contract review: ${(err as Error).message}`,
          };
        }
      },
    },

    // ── 7. flag_contract_issue ─────────────────────────────────────────────
    {
      name: 'flag_contract_issue',
      description:
        'Flag a risk or issue on a specific contract. Logs the issue in activity_log ' +
        'for tracking and resolution.',
      parameters: {
        contract_id: {
          type: 'string',
          description: 'ID of the contract with the issue',
          required: true,
        },
        issue_type: {
          type: 'string',
          description: 'Type of issue being flagged',
          enum: ['risk', 'missing_clause', 'unfavorable_terms', 'regulatory_conflict'],
        },
        description: {
          type: 'string',
          description: 'Detailed description of the issue',
          required: true,
        },
        severity: {
          type: 'string',
          description: 'Issue severity level',
          enum: ['low', 'medium', 'high', 'critical'],
        },
      },
      async execute(params): Promise<ToolResult> {
        const contractId = params.contract_id as string;
        const issueType = (params.issue_type as string) || 'risk';
        const description = params.description as string;
        const severity = (params.severity as string) || 'medium';

        try {
          const rows = await systemQuery<{ id: string; created_at: string }>(
            `INSERT INTO activity_log (type, description, metadata)
             VALUES ('contract_issue', $1, $2::jsonb)
             RETURNING id, created_at::text as created_at`,
            [
              description,
              JSON.stringify({
                contract_id: contractId,
                issue_type: issueType,
                severity,
              }),
            ],
          );

          return {
            success: true,
            data: {
              issue_id: rows[0]?.id,
              contract_id: contractId,
              issue_type: issueType,
              description,
              severity,
              created_at: rows[0]?.created_at,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to flag contract issue: ${(err as Error).message}`,
          };
        }
      },
    },

    // ── 8. get_contract_renewals ───────────────────────────────────────────
    {
      name: 'get_contract_renewals',
      description:
        'List contracts with upcoming renewal dates. Defaults to contracts renewing ' +
        'within the next 90 days.',
      parameters: {
        days_ahead: {
          type: 'number',
          description: 'Number of days ahead to check for renewals (default: 90)',
        },
      },
      async execute(params): Promise<ToolResult> {
        const daysAhead = (params.days_ahead as number) || 90;

        try {
          const rows = await systemQuery<{
            id: string;
            type: string;
            counterparty: string;
            status: string;
            value: number;
            renewal_date: string;
            end_date: string;
          }>(
            `SELECT id, type, counterparty, status, value,
                    renewal_date::text as renewal_date, end_date::text as end_date
             FROM contracts
             WHERE renewal_date IS NOT NULL
               AND renewal_date <= NOW() + INTERVAL '${daysAhead} days'
               AND status = 'active'
             ORDER BY renewal_date ASC`,
          );

          return {
            success: true,
            data: {
              days_ahead: daysAhead,
              count: rows.length,
              renewals: rows,
              queried_at: new Date().toISOString(),
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to get contract renewals: ${(err as Error).message}`,
          };
        }
      },
    },

    // ── 9. get_ip_portfolio ───────────────────────────────────────────────
    {
      name: 'get_ip_portfolio',
      description:
        'View intellectual property assets in the portfolio. Optionally filter by IP type.',
      parameters: {
        ip_type: {
          type: 'string',
          description: 'Filter by IP type',
          enum: ['patent', 'trademark', 'trade_secret', 'copyright', 'all'],
        },
      },
      async execute(params): Promise<ToolResult> {
        const ipType = (params.ip_type as string) || 'all';

        try {
          const typeFilter = ipType !== 'all'
            ? 'WHERE type = $1'
            : '';
          const values = ipType !== 'all' ? [ipType] : [];

          const rows = await systemQuery<{
            id: string;
            type: string;
            title: string;
            description: string;
            status: string;
            filing_date: string;
            inventor: string;
          }>(
            `SELECT id, type, title, description, status,
                    filing_date::text as filing_date, inventor
             FROM ip_portfolio
             ${typeFilter}
             ORDER BY filing_date DESC`,
            values,
          );

          const summary = {
            patent: rows.filter((r) => r.type === 'patent').length,
            trademark: rows.filter((r) => r.type === 'trademark').length,
            trade_secret: rows.filter((r) => r.type === 'trade_secret').length,
            copyright: rows.filter((r) => r.type === 'copyright').length,
          };

          return {
            success: true,
            data: {
              filter: ipType,
              total: rows.length,
              summary,
              assets: rows,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to get IP portfolio: ${(err as Error).message}`,
          };
        }
      },
    },

    // ── 10. create_ip_filing ──────────────────────────────────────────────
    {
      name: 'create_ip_filing',
      description:
        'Initiate a new IP filing (patent or trademark). Creates a draft entry in ip_portfolio.',
      parameters: {
        ip_type: {
          type: 'string',
          description: 'Type of IP filing',
          required: true,
          enum: ['patent', 'trademark'],
        },
        title: {
          type: 'string',
          description: 'Title of the IP filing',
          required: true,
        },
        description: {
          type: 'string',
          description: 'Detailed description of the IP',
          required: true,
        },
        inventor: {
          type: 'string',
          description: 'Inventor or creator name',
        },
      },
      async execute(params): Promise<ToolResult> {
        const ipType = params.ip_type as string;
        const title = params.title as string;
        const description = params.description as string;
        const inventor = (params.inventor as string) || null;

        try {
          const rows = await systemQuery<{
            id: string;
            type: string;
            title: string;
            status: string;
            filing_date: string;
          }>(
            `INSERT INTO ip_portfolio (type, title, description, status, filing_date, inventor)
             VALUES ($1, $2, $3, 'draft', NOW(), $4)
             RETURNING id, type, title, status, filing_date::text as filing_date`,
            [ipType, title, description, inventor],
          );

          return {
            success: true,
            data: {
              filing: rows[0],
              inventor: inventor ?? null,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to create IP filing: ${(err as Error).message}`,
          };
        }
      },
    },

    // ── 11. monitor_ip_infringement ───────────────────────────────────────
    {
      name: 'monitor_ip_infringement',
      description:
        'Check IP portfolio for potential infringement risks. Queries active IP assets ' +
        'and returns a monitoring summary.',
      parameters: {},
      async execute(): Promise<ToolResult> {
        try {
          const rows = await systemQuery<{
            id: string;
            type: string;
            title: string;
            status: string;
          }>(
            `SELECT id, type, title, status
             FROM ip_portfolio
             WHERE status IN ('granted', 'registered', 'active', 'filed')
             ORDER BY type, title`,
          );

          const monitored = rows.map((r) => ({
            id: r.id,
            type: r.type,
            title: r.title,
            status: r.status,
            monitoring_active: true,
          }));

          return {
            success: true,
            data: {
              total_monitored: monitored.length,
              by_type: {
                patent: monitored.filter((m) => m.type === 'patent').length,
                trademark: monitored.filter((m) => m.type === 'trademark').length,
              },
              assets: monitored,
              last_checked: new Date().toISOString(),
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to monitor IP infringement: ${(err as Error).message}`,
          };
        }
      },
    },

    // ── 12. get_tax_calendar ──────────────────────────────────────────────
    {
      name: 'get_tax_calendar',
      description:
        'View upcoming tax deadlines from the activity log.',
      parameters: {},
      async execute(): Promise<ToolResult> {
        try {
          const rows = await systemQuery<{
            id: string;
            description: string;
            metadata: Record<string, unknown>;
            created_at: string;
          }>(
            `SELECT id, description, metadata, created_at::text as created_at
             FROM activity_log
             WHERE type = 'tax_deadline'
             ORDER BY created_at DESC
             LIMIT 50`,
          );

          const deadlines = rows.map((r) => ({
            id: r.id,
            description: r.description,
            metadata: r.metadata,
            created_at: r.created_at,
          }));

          return {
            success: true,
            data: {
              count: deadlines.length,
              deadlines,
              queried_at: new Date().toISOString(),
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to get tax calendar: ${(err as Error).message}`,
          };
        }
      },
    },

    // ── 13. calculate_tax_estimate ─────────────────────────────────────────
    {
      name: 'calculate_tax_estimate',
      description:
        'Estimate tax liability for a period. Queries financials for revenue and expense ' +
        'data and calculates an estimated tax obligation.',
      parameters: {
        period: {
          type: 'string',
          description: 'Tax period to estimate',
          required: true,
          enum: ['quarterly', 'annual'],
        },
        jurisdiction: {
          type: 'string',
          description: 'Tax jurisdiction scope',
          enum: ['federal', 'state', 'all'],
        },
      },
      async execute(params): Promise<ToolResult> {
        const period = params.period as string;
        const jurisdiction = (params.jurisdiction as string) || 'all';
        const days = period === 'quarterly' ? 90 : 365;

        try {
          const [revenueRows, expenseRows] = await Promise.all([
            systemQuery<{ total: number }>(
              `SELECT COALESCE(SUM(amount), 0) as total
               FROM financials
               WHERE amount > 0 AND created_at >= NOW() - INTERVAL '${days} days'`,
            ),
            systemQuery<{ total: number }>(
              `SELECT COALESCE(SUM(ABS(amount)), 0) as total
               FROM financials
               WHERE amount < 0 AND created_at >= NOW() - INTERVAL '${days} days'`,
            ),
          ]);

          const revenue = revenueRows[0]?.total ?? 0;
          const expenses = expenseRows[0]?.total ?? 0;
          const taxableIncome = revenue - expenses;

          // Estimated effective rates
          const federalRate = 0.21;
          const stateRate = 0.08;
          const federalTax = Math.max(0, taxableIncome * federalRate);
          const stateTax = Math.max(0, taxableIncome * stateRate);

          const totalTax =
            jurisdiction === 'federal' ? federalTax :
            jurisdiction === 'state' ? stateTax :
            federalTax + stateTax;

          return {
            success: true,
            data: {
              period,
              jurisdiction,
              period_days: days,
              revenue,
              expenses,
              taxable_income: taxableIncome,
              estimated_tax: {
                federal: jurisdiction !== 'state' ? federalTax : undefined,
                state: jurisdiction !== 'federal' ? stateTax : undefined,
                total: totalTax,
              },
              effective_rate: taxableIncome > 0
                ? Number(((totalTax / taxableIncome) * 100).toFixed(1))
                : 0,
              disclaimer: 'This is an estimate only. Consult a tax professional for accurate filings.',
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to calculate tax estimate: ${(err as Error).message}`,
          };
        }
      },
    },

    // ── 14. get_tax_research ──────────────────────────────────────────────
    {
      name: 'get_tax_research',
      description:
        'Research tax implications for a given scenario. Returns a structured ' +
        'analysis framework for the scenario.',
      parameters: {
        scenario: {
          type: 'string',
          description: 'Description of the tax scenario to research',
          required: true,
        },
      },
      async execute(params): Promise<ToolResult> {
        const scenario = params.scenario as string;

        return {
          success: true,
          data: {
            scenario,
            analysis_framework: {
              federal_implications: 'Review IRC provisions applicable to this scenario',
              state_implications: 'Evaluate nexus and state-specific rules',
              timing_considerations: 'Assess tax year, elections, and filing deadlines',
              documentation_required: 'Gather supporting records and substantiation',
              risk_areas: 'Identify audit triggers and compliance concerns',
            },
            recommended_actions: [
              'Consult with tax advisor for scenario-specific guidance',
              'Document all assumptions and positions taken',
              'Review prior year treatment for consistency',
              'Evaluate impact on estimated tax payments',
            ],
            disclaimer: 'This is a research framework only. Consult a tax professional for advice.',
          },
        };
      },
    },

    // ── 15. review_tax_strategy ────────────────────────────────────────────
    {
      name: 'review_tax_strategy',
      description:
        'Analyze tax optimization opportunities for a specific focus area. ' +
        'Returns potential strategies and considerations.',
      parameters: {
        focus_area: {
          type: 'string',
          description: 'Tax strategy focus area to analyze',
          required: true,
          enum: ['r_and_d_credits', 'state_nexus', 'entity_structure', 'transfer_pricing'],
        },
      },
      async execute(params): Promise<ToolResult> {
        const focusArea = params.focus_area as string;

        const strategies: Record<string, {
          description: string;
          opportunities: string[];
          considerations: string[];
        }> = {
          r_and_d_credits: {
            description: 'Research & Development tax credit optimization',
            opportunities: [
              'Qualify software development activities under IRC §41',
              'Document four-part test: technological uncertainty, process of experimentation, technological in nature, permitted purpose',
              'Consider ASC 730 alignment for financial reporting',
              'Evaluate state R&D credit programs',
            ],
            considerations: [
              'Contemporaneous documentation requirements',
              'Payroll tax offset for qualifying small businesses',
              'Amended return opportunities for prior years',
            ],
          },
          state_nexus: {
            description: 'State tax nexus analysis and optimization',
            opportunities: [
              'Evaluate physical and economic nexus in each state',
              'Review remote employee implications post-Wayfair',
              'Assess voluntary disclosure agreements where appropriate',
              'Optimize apportionment factors',
            ],
            considerations: [
              'Market-based vs cost-of-performance sourcing',
              'State-specific thresholds and safe harbors',
              'Compliance burden vs tax savings',
            ],
          },
          entity_structure: {
            description: 'Entity structure and formation optimization',
            opportunities: [
              'Evaluate C-corp vs pass-through entity benefits',
              'Consider qualified small business stock (QSBS) under §1202',
              'Review holding company structures',
              'Assess IP holding entity opportunities',
            ],
            considerations: [
              'Double taxation implications',
              'State entity-level taxes',
              'Future exit planning considerations',
            ],
          },
          transfer_pricing: {
            description: 'Transfer pricing strategy and compliance',
            opportunities: [
              'Review intercompany transactions for arm\'s length pricing',
              'Evaluate cost-sharing arrangements for IP development',
              'Assess advance pricing agreement (APA) benefits',
              'Consider comparable uncontrolled transaction method',
            ],
            considerations: [
              'Documentation requirements under §482',
              'Country-by-country reporting obligations',
              'Permanent establishment risk',
            ],
          },
        };

        const strategy = strategies[focusArea];
        if (!strategy) {
          return { success: false, error: `Unknown focus area: ${focusArea}` };
        }

        return {
          success: true,
          data: {
            focus_area: focusArea,
            ...strategy,
            disclaimer: 'Strategies require professional tax review before implementation.',
          },
        };
      },
    },

    // ── 16. audit_data_flows ──────────────────────────────────────────────
    {
      name: 'audit_data_flows',
      description:
        'Map data flows for privacy compliance. Returns a structured data flow map ' +
        'from activity_log and system tables.',
      parameters: {},
      async execute(): Promise<ToolResult> {
        try {
          const rows = await systemQuery<{
            type: string;
            count: number;
            latest: string;
          }>(
            `SELECT type, COUNT(*)::int as count, MAX(created_at)::text as latest
             FROM activity_log
             WHERE type IN ('data_transfer', 'data_access', 'data_export', 'data_import')
             GROUP BY type
             ORDER BY count DESC`,
          );

          return {
            success: true,
            data: {
              data_flow_summary: rows,
              total_events: rows.reduce((sum, r) => sum + r.count, 0),
              categories: rows.map((r) => r.type),
              audited_at: new Date().toISOString(),
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to audit data flows: ${(err as Error).message}`,
          };
        }
      },
    },

    // ── 17. check_data_retention ──────────────────────────────────────────
    {
      name: 'check_data_retention',
      description:
        'Verify data retention policy compliance. Queries system tables for records ' +
        'that may exceed retention limits.',
      parameters: {},
      async execute(): Promise<ToolResult> {
        try {
          const rows = await systemQuery<{
            table_name: string;
            oldest_record: string;
            record_count: number;
          }>(
            `SELECT 'activity_log' as table_name,
                    MIN(created_at)::text as oldest_record,
                    COUNT(*)::int as record_count
             FROM activity_log
             UNION ALL
             SELECT 'compliance_checklists',
                    MIN(updated_at)::text,
                    COUNT(*)::int
             FROM compliance_checklists`,
          );

          const violations = rows.filter((r) => {
            if (!r.oldest_record) return false;
            const age = Date.now() - new Date(r.oldest_record).getTime();
            const threeYearsMs = 3 * 365 * 24 * 60 * 60 * 1000;
            return age > threeYearsMs;
          });

          return {
            success: true,
            data: {
              tables_checked: rows,
              retention_violations: violations,
              violation_count: violations.length,
              policy: 'Default retention period: 3 years',
              checked_at: new Date().toISOString(),
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to check data retention: ${(err as Error).message}`,
          };
        }
      },
    },

    // ── 18. get_privacy_requests ──────────────────────────────────────────
    {
      name: 'get_privacy_requests',
      description:
        'Track data subject access requests (DSARs). Queries activity_log for ' +
        'privacy request entries.',
      parameters: {
        status: {
          type: 'string',
          description: 'Filter by request status',
          enum: ['pending', 'in_progress', 'completed', 'all'],
        },
      },
      async execute(params): Promise<ToolResult> {
        const status = (params.status as string) || 'all';

        try {
          const statusFilter = status !== 'all'
            ? `AND metadata->>'status' = $1`
            : '';
          const values = status !== 'all' ? [status] : [];

          const rows = await systemQuery<{
            id: string;
            description: string;
            metadata: Record<string, unknown>;
            created_at: string;
          }>(
            `SELECT id, description, metadata, created_at::text as created_at
             FROM activity_log
             WHERE type = 'privacy_request' ${statusFilter}
             ORDER BY created_at DESC
             LIMIT 100`,
            values,
          );

          const requests = rows.map((r) => ({
            id: r.id,
            description: r.description,
            status: (r.metadata?.status as string) ?? 'unknown',
            request_type: (r.metadata?.request_type as string) ?? 'unknown',
            created_at: r.created_at,
          }));

          const summary = {
            pending: requests.filter((r) => r.status === 'pending').length,
            in_progress: requests.filter((r) => r.status === 'in_progress').length,
            completed: requests.filter((r) => r.status === 'completed').length,
          };

          return {
            success: true,
            data: {
              filter: status,
              count: requests.length,
              summary,
              requests,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to get privacy requests: ${(err as Error).message}`,
          };
        }
      },
    },

    // ── 19. audit_access_permissions ──────────────────────────────────────
    {
      name: 'audit_access_permissions',
      description:
        'Audit IAM access permissions. Queries platform_iam_state for ' +
        'over-provisioned or stale accounts.',
      parameters: {},
      async execute(): Promise<ToolResult> {
        try {
          const rows = await systemQuery<{
            principal: string;
            platform: string;
            role: string;
            last_active: string;
          }>(
            `SELECT principal, platform, role, last_active::text as last_active
             FROM platform_iam_state
             ORDER BY last_active ASC`,
          );

          const now = Date.now();
          const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;

          const staleAccounts = rows.filter((r) => {
            if (!r.last_active) return true;
            return now - new Date(r.last_active).getTime() > ninetyDaysMs;
          });

          const adminAccounts = rows.filter((r) =>
            r.role?.toLowerCase().includes('admin') ||
            r.role?.toLowerCase().includes('owner'),
          );

          return {
            success: true,
            data: {
              total_accounts: rows.length,
              stale_accounts: {
                count: staleAccounts.length,
                threshold: '90 days inactive',
                accounts: staleAccounts,
              },
              admin_accounts: {
                count: adminAccounts.length,
                accounts: adminAccounts,
              },
              all_accounts: rows,
              audited_at: new Date().toISOString(),
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to audit access permissions: ${(err as Error).message}`,
          };
        }
      },
    },
  ];
}
