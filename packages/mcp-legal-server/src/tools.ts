import type { Pool } from 'pg';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
  };
  handler: (pool: Pool, params: Record<string, unknown>) => Promise<unknown[]>;
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
];
