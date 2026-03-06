import type { Pool } from 'pg';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required?: string[];
  };
  handler: (pool: Pool, params: Record<string, unknown>) => Promise<unknown>;
}

function clampLimit(raw: unknown, defaultVal = 50, max = 200): number {
  const n = typeof raw === 'number' ? raw : Number(raw ?? defaultVal);
  return Math.min(Math.max(1, Math.floor(n)), max);
}

export const tools: ToolDefinition[] = [
  // ── Regulatory Tracking ──────────────────────────────────
  {
    name: 'track_regulations',
    description: 'Track regulatory changes and compliance requirements from the activity log. Filters by jurisdiction and topic.',
    inputSchema: {
      type: 'object',
      properties: {
        jurisdictions: { type: 'string', description: 'Comma-separated jurisdictions to filter (e.g. "US,EU,CA").' },
        topics: { type: 'string', description: 'Comma-separated topics to filter (e.g. "AI,privacy,data").' },
        limit: { type: 'number', description: 'Max rows to return (default 50, max 200).' },
      },
    },
    async handler(pool, params) {
      const conditions = ["activity_type = 'regulatory_update'"];
      const values: unknown[] = [];
      if (params.jurisdictions) {
        const list = (params.jurisdictions as string).split(',').map(s => s.trim());
        values.push(list);
        conditions.push(`metadata->>'jurisdiction' = ANY($${values.length})`);
      }
      if (params.topics) {
        const list = (params.topics as string).split(',').map(s => s.trim());
        values.push(list);
        conditions.push(`metadata->>'topic' = ANY($${values.length})`);
      }
      const limit = clampLimit(params.limit);
      values.push(limit);
      const where = `WHERE ${conditions.join(' AND ')}`;
      const { rows } = await pool.query(
        `SELECT * FROM activity_log ${where} ORDER BY created_at DESC LIMIT $${values.length}`,
        values,
      );
      return rows;
    },
  },

  // ── Compliance ───────────────────────────────────────────
  {
    name: 'get_compliance_status',
    description: 'Get compliance checklist items, optionally filtered by framework (SOC2, GDPR, HIPAA, CCPA, ISO27001).',
    inputSchema: {
      type: 'object',
      properties: {
        framework: { type: 'string', description: 'Compliance framework to filter by.', enum: ['SOC2', 'GDPR', 'HIPAA', 'CCPA', 'ISO27001'] },
        limit: { type: 'number', description: 'Max rows to return (default 50, max 200).' },
      },
    },
    async handler(pool, params) {
      const conditions: string[] = [];
      const values: unknown[] = [];
      if (params.framework) {
        values.push(params.framework);
        conditions.push(`framework = $${values.length}`);
      }
      const limit = clampLimit(params.limit);
      values.push(limit);
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const { rows } = await pool.query(
        `SELECT * FROM compliance_checklists ${where} ORDER BY updated_at DESC LIMIT $${values.length}`,
        values,
      );
      return rows;
    },
  },

  // ── Contracts ────────────────────────────────────────────
  {
    name: 'get_contracts',
    description: 'Query contracts, optionally filtered by type, status, or counterparty.',
    inputSchema: {
      type: 'object',
      properties: {
        contract_type: { type: 'string', description: 'Filter by contract type.', enum: ['SaaS', 'employment', 'NDA', 'vendor', 'partnership', 'consulting'] },
        status: { type: 'string', description: 'Filter by contract status.', enum: ['active', 'expired', 'pending', 'terminated'] },
        counterparty: { type: 'string', description: 'Filter by counterparty name (partial match).' },
        limit: { type: 'number', description: 'Max rows to return (default 50, max 200).' },
      },
    },
    async handler(pool, params) {
      const conditions: string[] = [];
      const values: unknown[] = [];
      if (params.contract_type) { values.push(params.contract_type); conditions.push(`contract_type = $${values.length}`); }
      if (params.status) { values.push(params.status); conditions.push(`status = $${values.length}`); }
      if (params.counterparty) { values.push(`%${params.counterparty}%`); conditions.push(`counterparty ILIKE $${values.length}`); }
      const limit = clampLimit(params.limit);
      values.push(limit);
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const { rows } = await pool.query(
        `SELECT * FROM contracts ${where} ORDER BY created_at DESC LIMIT $${values.length}`,
        values,
      );
      return rows;
    },
  },

  // ── Contract Renewals ────────────────────────────────────
  {
    name: 'get_contract_renewals',
    description: 'Get contracts expiring within a given number of days.',
    inputSchema: {
      type: 'object',
      properties: {
        days_ahead: { type: 'number', description: 'Number of days to look ahead for renewals (default: 90).' },
      },
    },
    async handler(pool, params) {
      const days = typeof params.days_ahead === 'number' ? params.days_ahead : 90;
      const { rows } = await pool.query(
        `SELECT * FROM contracts
         WHERE status = 'active'
           AND end_date IS NOT NULL
           AND end_date <= NOW() + ($1 || ' days')::INTERVAL
         ORDER BY end_date ASC`,
        [String(days)],
      );
      return rows;
    },
  },

  // ── IP Portfolio ─────────────────────────────────────────
  {
    name: 'get_ip_portfolio',
    description: 'Query intellectual property portfolio, optionally filtered by IP type.',
    inputSchema: {
      type: 'object',
      properties: {
        ip_type: { type: 'string', description: 'Filter by IP type.', enum: ['patent', 'trademark', 'copyright', 'trade_secret'] },
        limit: { type: 'number', description: 'Max rows to return (default 50, max 200).' },
      },
    },
    async handler(pool, params) {
      const conditions: string[] = [];
      const values: unknown[] = [];
      if (params.ip_type) { values.push(params.ip_type); conditions.push(`ip_type = $${values.length}`); }
      const limit = clampLimit(params.limit);
      values.push(limit);
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const { rows } = await pool.query(
        `SELECT * FROM ip_portfolio ${where} ORDER BY created_at DESC LIMIT $${values.length}`,
        values,
      );
      return rows;
    },
  },

  // ── IP Infringement Monitor ──────────────────────────────
  {
    name: 'monitor_ip_infringement',
    description: 'Check for potential IP infringement risks based on portfolio monitoring status.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max rows to return (default 50, max 200).' },
      },
    },
    async handler(pool, params) {
      const limit = clampLimit(params.limit);
      const { rows } = await pool.query(
        `SELECT * FROM ip_portfolio
         WHERE status IN ('at_risk', 'expired', 'pending_renewal')
         ORDER BY updated_at DESC LIMIT $1`,
        [limit],
      );
      return rows;
    },
  },

  // ── Tax Calendar ─────────────────────────────────────────
  {
    name: 'get_tax_calendar',
    description: 'Get upcoming tax deadlines and filings from the activity log.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max rows to return (default 50, max 200).' },
      },
    },
    async handler(pool, params) {
      const limit = clampLimit(params.limit);
      const { rows } = await pool.query(
        `SELECT * FROM activity_log
         WHERE activity_type IN ('tax_deadline', 'tax_filing')
         ORDER BY created_at DESC LIMIT $1`,
        [limit],
      );
      return rows;
    },
  },

  // ── Tax Estimates ────────────────────────────────────────
  {
    name: 'calculate_tax_estimate',
    description: 'Get financial data for tax estimation by period and jurisdiction.',
    inputSchema: {
      type: 'object',
      properties: {
        period: { type: 'string', description: 'Tax period to analyze.', enum: ['Q1', 'Q2', 'Q3', 'Q4', 'annual'] },
        jurisdiction: { type: 'string', description: 'Tax jurisdiction.', enum: ['US_federal', 'US_state', 'EU', 'international'] },
        limit: { type: 'number', description: 'Max rows to return (default 50, max 200).' },
      },
    },
    async handler(pool, params) {
      const conditions: string[] = [];
      const values: unknown[] = [];
      if (params.period) { values.push(params.period); conditions.push(`period = $${values.length}`); }
      if (params.jurisdiction) { values.push(params.jurisdiction); conditions.push(`jurisdiction = $${values.length}`); }
      const limit = clampLimit(params.limit);
      values.push(limit);
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const { rows } = await pool.query(
        `SELECT * FROM financials ${where} ORDER BY recorded_at DESC LIMIT $${values.length}`,
        values,
      );
      return rows;
    },
  },

  // ── Data Flow Audit ──────────────────────────────────────
  {
    name: 'audit_data_flows',
    description: 'Audit data flows logged in the activity log for privacy and compliance review.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max rows to return (default 50, max 200).' },
      },
    },
    async handler(pool, params) {
      const limit = clampLimit(params.limit);
      const { rows } = await pool.query(
        `SELECT * FROM activity_log
         WHERE activity_type IN ('data_flow', 'data_transfer', 'data_access')
         ORDER BY created_at DESC LIMIT $1`,
        [limit],
      );
      return rows;
    },
  },

  // ── Data Retention ───────────────────────────────────────
  {
    name: 'check_data_retention',
    description: 'Check data retention compliance status across activity log and compliance checklists.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max rows to return (default 50, max 200).' },
      },
    },
    async handler(pool, params) {
      const limit = clampLimit(params.limit);
      const { rows } = await pool.query(
        `SELECT * FROM compliance_checklists
         WHERE requirement ILIKE '%retention%' OR requirement ILIKE '%deletion%'
         ORDER BY updated_at DESC LIMIT $1`,
        [limit],
      );
      return rows;
    },
  },

  // ── Privacy Requests ─────────────────────────────────────
  {
    name: 'get_privacy_requests',
    description: 'Get data subject access requests (DSARs) and privacy-related activity.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Filter by request status.', enum: ['pending', 'in_progress', 'completed', 'denied'] },
        limit: { type: 'number', description: 'Max rows to return (default 50, max 200).' },
      },
    },
    async handler(pool, params) {
      const conditions = ["activity_type IN ('dsar', 'privacy_request', 'data_deletion_request')"];
      const values: unknown[] = [];
      if (params.status) {
        values.push(params.status);
        conditions.push(`metadata->>'status' = $${values.length}`);
      }
      const limit = clampLimit(params.limit);
      values.push(limit);
      const where = `WHERE ${conditions.join(' AND ')}`;
      const { rows } = await pool.query(
        `SELECT * FROM activity_log ${where} ORDER BY created_at DESC LIMIT $${values.length}`,
        values,
      );
      return rows;
    },
  },

  // ── Access Permissions Audit ─────────────────────────────
  {
    name: 'audit_access_permissions',
    description: 'Audit IAM access permissions and platform access state.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max rows to return (default 50, max 200).' },
      },
    },
    async handler(pool, params) {
      const limit = clampLimit(params.limit);
      const { rows } = await pool.query(
        `SELECT * FROM platform_iam_state ORDER BY updated_at DESC LIMIT $1`,
        [limit],
      );
      return rows;
    },
  },

  // ── Update Compliance Item ───────────────────────────────
  {
    name: 'update_compliance_item',
    description: 'Update a compliance checklist item with new status, evidence, or notes.',
    inputSchema: {
      type: 'object',
      properties: {
        item_id: { type: 'string', description: 'ID of the compliance checklist item to update.' },
        status: { type: 'string', description: 'New compliance status.', enum: ['compliant', 'non_compliant', 'in_progress', 'not_applicable'] },
        evidence: { type: 'string', description: 'Evidence or documentation supporting the status.' },
        notes: { type: 'string', description: 'Additional notes about the compliance item.' },
      },
      required: ['item_id', 'status'],
    },
    async handler(pool, params) {
      const itemId = params.item_id as string;
      const status = params.status as string;
      const evidence = params.evidence as string | undefined;
      const notes = params.notes as string | undefined;

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
      const { rows } = await pool.query(
        `UPDATE compliance_checklists
         SET ${setClauses.join(', ')}
         WHERE id = $${paramIndex}
         RETURNING id, item, status`,
        values,
      );

      if (rows.length === 0) {
        throw new Error(`Compliance item ${itemId} not found`);
      }

      return { updated: rows[0], evidence: evidence ?? null, notes: notes ?? null };
    },
  },

  // ── Create Compliance Alert ──────────────────────────────
  {
    name: 'create_compliance_alert',
    description: 'Set up a compliance monitoring alert. Inserts an alert entry into activity_log for tracking and notification.',
    inputSchema: {
      type: 'object',
      properties: {
        trigger_description: { type: 'string', description: 'Description of what triggers this alert.' },
        severity: { type: 'string', description: 'Alert severity level.', enum: ['low', 'medium', 'high', 'critical'] },
        notification_targets: { type: 'string', description: 'Comma-separated notification targets (e.g., emails or Slack channels).' },
      },
      required: ['trigger_description'],
    },
    async handler(pool, params) {
      const triggerDescription = params.trigger_description as string;
      const severity = (params.severity as string) || 'medium';
      const notificationTargets = params.notification_targets as string | undefined;

      const { rows } = await pool.query(
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
        alert_id: rows[0]?.id,
        trigger_description: triggerDescription,
        severity,
        notification_targets: notificationTargets || null,
        created_at: rows[0]?.created_at,
      };
    },
  },

  // ── Create Contract Review ───────────────────────────────
  {
    name: 'create_contract_review',
    description: 'Start a contract review workflow by logging a review entry in activity_log.',
    inputSchema: {
      type: 'object',
      properties: {
        contract_type: { type: 'string', description: 'Type of contract being reviewed.' },
        counterparty: { type: 'string', description: 'Counterparty for the contract.' },
        key_terms: { type: 'string', description: 'Key terms to review (comma-separated or free text).' },
        deadline: { type: 'string', description: 'Review deadline (ISO date string).' },
      },
      required: ['contract_type', 'counterparty', 'key_terms'],
    },
    async handler(pool, params) {
      const contractType = params.contract_type as string;
      const counterparty = params.counterparty as string;
      const keyTerms = params.key_terms as string;
      const deadline = params.deadline as string | undefined;

      const { rows } = await pool.query(
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
        review_id: rows[0]?.id,
        contract_type: contractType,
        counterparty,
        key_terms: keyTerms,
        deadline: deadline || null,
        created_at: rows[0]?.created_at,
      };
    },
  },

  // ── Flag Contract Issue ──────────────────────────────────
  {
    name: 'flag_contract_issue',
    description: 'Flag a risk or issue on a specific contract. Logs the issue in activity_log for tracking and resolution.',
    inputSchema: {
      type: 'object',
      properties: {
        contract_id: { type: 'string', description: 'ID of the contract with the issue.' },
        issue_type: { type: 'string', description: 'Type of issue being flagged.', enum: ['risk', 'missing_clause', 'unfavorable_terms', 'regulatory_conflict'] },
        description: { type: 'string', description: 'Detailed description of the issue.' },
        severity: { type: 'string', description: 'Issue severity level.', enum: ['low', 'medium', 'high', 'critical'] },
      },
      required: ['contract_id', 'description'],
    },
    async handler(pool, params) {
      const contractId = params.contract_id as string;
      const issueType = (params.issue_type as string) || 'risk';
      const description = params.description as string;
      const severity = (params.severity as string) || 'medium';

      const { rows } = await pool.query(
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
        issue_id: rows[0]?.id,
        contract_id: contractId,
        issue_type: issueType,
        description,
        severity,
        created_at: rows[0]?.created_at,
      };
    },
  },

  // ── Create IP Filing ─────────────────────────────────────
  {
    name: 'create_ip_filing',
    description: 'Initiate a new IP filing (patent or trademark). Creates a draft entry in ip_portfolio.',
    inputSchema: {
      type: 'object',
      properties: {
        ip_type: { type: 'string', description: 'Type of IP filing.', enum: ['patent', 'trademark'] },
        title: { type: 'string', description: 'Title of the IP filing.' },
        description: { type: 'string', description: 'Detailed description of the IP.' },
        inventor: { type: 'string', description: 'Inventor or creator name.' },
      },
      required: ['ip_type', 'title', 'description'],
    },
    async handler(pool, params) {
      const ipType = params.ip_type as string;
      const title = params.title as string;
      const description = params.description as string;
      const inventor = (params.inventor as string) || null;

      const { rows } = await pool.query(
        `INSERT INTO ip_portfolio (type, title, description, status, filing_date, inventor)
         VALUES ($1, $2, $3, 'draft', NOW(), $4)
         RETURNING id, type, title, status, filing_date::text as filing_date`,
        [ipType, title, description, inventor],
      );

      return { filing: rows[0], inventor };
    },
  },

  // ── Tax Research ─────────────────────────────────────────
  {
    name: 'get_tax_research',
    description:
      'Research tax implications for a given scenario. Returns a structured analysis framework.',
    inputSchema: {
      type: 'object',
      properties: {
        scenario: { type: 'string', description: 'Description of the tax scenario to research.' },
      },
      required: ['scenario'],
    },
    async handler(_pool, params) {
      const scenario = params.scenario as string;
      return {
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
      };
    },
  },

  // ── Tax Strategy Review ──────────────────────────────────
  {
    name: 'review_tax_strategy',
    description:
      'Analyze tax optimization opportunities for a specific focus area. Returns potential strategies and considerations.',
    inputSchema: {
      type: 'object',
      properties: {
        focus_area: { type: 'string', description: 'Tax strategy focus area to analyze.', enum: ['r_and_d_credits', 'state_nexus', 'entity_structure', 'transfer_pricing'] },
      },
      required: ['focus_area'],
    },
    async handler(_pool, params) {
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
        throw new Error(`Unknown focus area: ${focusArea}`);
      }

      return {
        focus_area: focusArea,
        ...strategy,
        disclaimer: 'Strategies require professional tax review before implementation.',
      };
    },
  },
];
