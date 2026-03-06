/**
 * Legal Tools — Write/logic tools for compliance, contracts, IP, and tax
 *
 * Read-only legal tools (track_regulations, get_compliance_status, get_contracts,
 * get_contract_renewals, get_ip_portfolio, monitor_ip_infringement, get_tax_calendar,
 * calculate_tax_estimate, audit_data_flows, check_data_retention, get_privacy_requests,
 * audit_access_permissions) are now served via mcp-legal-server.
 *
 * Tools:
 *   update_compliance_item     — Update a compliance checklist item
 *   create_compliance_alert    — Set up a compliance monitoring alert
 *   create_contract_review     — Initiate a contract review workflow
 *   flag_contract_issue        — Flag a risk or issue on a contract
 *   create_ip_filing           — Initiate a new IP filing (patent/trademark)
 *   get_tax_research           — Research tax implications for a scenario
 *   review_tax_strategy        — Analyze tax optimization opportunities
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';

export function createLegalTools(): ToolDefinition[] {
  return [
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
  ];
}
