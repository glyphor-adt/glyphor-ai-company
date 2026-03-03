/**
 * Layer 16 – Tool Health Check
 *
 * Validates that shared tools load, have valid schemas, handle errors gracefully,
 * and are properly registered + granted. This catches tools that crash instead of
 * returning clean error results when agents try to use them.
 *
 * Tests:
 *   T16.1  Factory Instantiation — all 18 Wave 1-5 factories load without throwing
 *   T16.2  Schema Validation — every tool has name, description, parameters, execute
 *   T16.3  Environment Variables — required API credentials are present
 *   T16.4  Database Tables — tables queried by tools exist
 *   T16.5  Execute Safety — each tool returns ToolResult (not throws) on empty params
 *   T16.6  Registry Coverage — every tool name exists in KNOWN_TOOLS
 *   T16.7  Grant Coverage — agents have grants for their wired tools
 */

import type { SmokeTestConfig, TestResult, LayerResult } from '../types.js';
import type { ToolDefinition, ToolContext } from '@glyphor/agent-runtime';
import { isKnownTool } from '@glyphor/agent-runtime';
import { runTest } from '../utils/test.js';
import { query } from '../utils/db.js';

// ── Wave 1 — Marketing ──────────────────────────────────────────────
import { createContentTools } from '@glyphor/agents/shared/contentTools';
import { createSeoTools } from '@glyphor/agents/shared/seoTools';
import { createSocialMediaTools } from '@glyphor/agents/shared/socialMediaTools';
import { createEmailMarketingTools } from '@glyphor/agents/shared/emailMarketingTools';
import { createMarketingIntelTools } from '@glyphor/agents/shared/marketingIntelTools';

// ── Wave 2 — Finance ────────────────────────────────────────────────
import { createRevenueTools } from '@glyphor/agents/shared/revenueTools';
import { createCostManagementTools } from '@glyphor/agents/shared/costManagementTools';
import { createCashFlowTools } from '@glyphor/agents/shared/cashFlowTools';

// ── Wave 3 — Product + Research ──────────────────────────────────────
import { createProductAnalyticsTools } from '@glyphor/agents/shared/productAnalyticsTools';
import { createUserResearchTools } from '@glyphor/agents/shared/userResearchTools';
import { createCompetitiveIntelTools } from '@glyphor/agents/shared/competitiveIntelTools';
import { createRoadmapTools } from '@glyphor/agents/shared/roadmapTools';
import { createResearchRepoTools } from '@glyphor/agents/shared/researchRepoTools';
import { createResearchMonitoringTools } from '@glyphor/agents/shared/researchMonitoringTools';

// ── Wave 4 — Governance ─────────────────────────────────────────────
import { createLegalTools } from '@glyphor/agents/shared/legalTools';
import { createHRTools } from '@glyphor/agents/shared/hrTools';
import { createOpsExtensionTools } from '@glyphor/agents/shared/opsExtensionTools';

// ── Wave 5 — Engineering ────────────────────────────────────────────
import { createEngineeringGapTools } from '@glyphor/agents/shared/engineeringGapTools';

// ═════════════════════════════════════════════════════════════════════
// Helpers
// ═════════════════════════════════════════════════════════════════════

interface FactoryEntry {
  name: string;
  wave: number;
  factory: () => ToolDefinition[];
}

const FACTORIES: FactoryEntry[] = [
  // Wave 1
  { name: 'contentTools', wave: 1, factory: createContentTools },
  { name: 'seoTools', wave: 1, factory: createSeoTools },
  { name: 'socialMediaTools', wave: 1, factory: createSocialMediaTools },
  { name: 'emailMarketingTools', wave: 1, factory: createEmailMarketingTools },
  { name: 'marketingIntelTools', wave: 1, factory: createMarketingIntelTools },
  // Wave 2
  { name: 'revenueTools', wave: 2, factory: createRevenueTools },
  { name: 'costManagementTools', wave: 2, factory: createCostManagementTools },
  { name: 'cashFlowTools', wave: 2, factory: createCashFlowTools },
  // Wave 3
  { name: 'productAnalyticsTools', wave: 3, factory: createProductAnalyticsTools },
  { name: 'userResearchTools', wave: 3, factory: createUserResearchTools },
  { name: 'competitiveIntelTools', wave: 3, factory: createCompetitiveIntelTools },
  { name: 'roadmapTools', wave: 3, factory: createRoadmapTools },
  { name: 'researchRepoTools', wave: 3, factory: createResearchRepoTools },
  { name: 'researchMonitoringTools', wave: 3, factory: createResearchMonitoringTools },
  // Wave 4
  { name: 'legalTools', wave: 4, factory: createLegalTools },
  { name: 'hrTools', wave: 4, factory: createHRTools },
  { name: 'opsExtensionTools', wave: 4, factory: createOpsExtensionTools },
  // Wave 5
  { name: 'engineeringGapTools', wave: 5, factory: createEngineeringGapTools },
];

/** Required env vars grouped by service. */
const ENV_REQUIREMENTS: Record<string, string[]> = {
  'Stripe (revenue)': ['STRIPE_SECRET_KEY'],
  'Mercury (banking)': ['MERCURY_API_TOKEN'],
  'Mailchimp (email campaigns)': ['GLYPHOR_MAILCHIMP_API'],
  'Mandrill (transactional email)': ['GLYPHOR_MANDRILL_API_KEY'],
  'OpenAI (content images)': ['OPENAI_API_KEY'],
  'Google Search Console (SEO)': ['GOOGLE_SEARCH_CONSOLE_CREDENTIALS'],
};

/** Tables that Wave 1-5 tools query (existing + new). */
const REQUIRED_TABLES = [
  // Wave 1
  'content_drafts', 'content_metrics', 'seo_data',
  'scheduled_posts', 'social_metrics', 'email_metrics', 'experiment_designs',
  // Wave 3 (new tables — may not exist yet)
  'analytics_events', 'roadmap_items', 'research_repository', 'research_monitors',
  // Wave 4 (new tables — may not exist yet)
  'compliance_checklists', 'contracts', 'ip_portfolio',
];

/** Agent → expected tool names (from wiring in run.ts files). */
const AGENT_TOOL_WIRING: Record<string, string[]> = {
  cmo: [
    'create_content_draft', 'update_content_draft', 'get_content_drafts',
    'publish_content', 'get_content_metrics', 'get_content_calendar', 'generate_content_image',
    'get_mailchimp_lists', 'create_mailchimp_campaign', 'set_campaign_content',
    'send_campaign', 'get_campaign_report', 'get_campaign_list',
    'create_ab_experiment', 'get_experiment_results', 'monitor_competitor_content',
    'get_lead_pipeline', 'get_marketing_dashboard',
  ],
  cfo: [
    'get_mrr_breakdown', 'get_subscription_details', 'get_churn_analysis',
    'get_revenue_forecast', 'get_stripe_invoices', 'get_customer_ltv',
    'get_gcp_costs', 'get_ai_model_costs', 'get_vendor_costs',
    'detect_cost_anomalies', 'get_burn_rate', 'get_budget_status',
    'get_unit_economics', 'set_cost_alert',
    'get_cash_balance', 'get_cash_flow', 'get_pending_transactions',
    'generate_financial_report', 'get_margin_analysis',
  ],
  cpo: [
    'get_analytics_events', 'get_usage_metrics', 'get_funnel_analysis',
    'get_cohort_analysis', 'get_feature_usage', 'get_user_segments',
    'track_competitor', 'get_competitor_profile', 'compare_features',
    'analyze_competitor_pricing', 'get_recent_launches', 'get_market_landscape',
    'get_competitive_alerts',
    'create_roadmap_item', 'score_feature_rice', 'get_roadmap',
    'update_roadmap_item', 'get_feature_requests', 'manage_feature_flags',
  ],
  clo: [
    'run_compliance_check', 'get_compliance_status', 'generate_compliance_report',
    'manage_compliance_checklist', 'schedule_audit',
    'create_contract', 'review_contract', 'get_contracts',
    'search_contracts', 'track_contract_renewals',
    'register_ip', 'get_ip_portfolio', 'check_ip_conflicts',
    'assess_tax_obligation', 'get_tax_calendar',
    'audit_data_retention', 'generate_privacy_report',
    'check_data_processing_agreements', 'manage_consent_records',
  ],
};

/** Minimal mock context for tool execution tests. */
function createMockContext(): ToolContext {
  return {
    agentId: 'smoketest-tool-check',
    agentRole: 'ops' as ToolContext['agentRole'],
    turnNumber: 0,
    abortSignal: new AbortController().signal,
    memoryBus: {
      write: async () => {},
      read: async () => null,
      search: async () => [],
    } as unknown as ToolContext['memoryBus'],
    emitEvent: () => {},
  };
}

/** Run a tool's execute with a timeout. Returns { success, error? } or { threw, error }. */
async function safeExecute(
  tool: ToolDefinition,
  timeoutMs = 8000,
): Promise<{ threw: boolean; timedOut: boolean; returned: boolean; error?: string }> {
  const ctx = createMockContext();
  try {
    const result = await Promise.race([
      tool.execute({}, ctx),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs),
      ),
    ]);
    // Check result shape
    if (result === null || result === undefined) {
      return { threw: false, timedOut: false, returned: false, error: 'returned null/undefined' };
    }
    if (typeof (result as unknown as Record<string, unknown>).success !== 'boolean') {
      return { threw: false, timedOut: false, returned: false, error: 'missing success field' };
    }
    return { threw: false, timedOut: false, returned: true };
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === 'TIMEOUT') {
      return { threw: false, timedOut: true, returned: false, error: 'timed out after 8s' };
    }
    return { threw: true, timedOut: false, returned: false, error: msg };
  }
}

// ═════════════════════════════════════════════════════════════════════
// Layer runner
// ═════════════════════════════════════════════════════════════════════

export async function run(_config: SmokeTestConfig): Promise<LayerResult> {
  const tests: TestResult[] = [];

  // ── T16.1 — Factory Instantiation ──────────────────────────────────
  tests.push(
    await runTest('T16.1', 'Tool Factories Load', async () => {
      const failures: string[] = [];
      let totalTools = 0;

      for (const entry of FACTORIES) {
        try {
          const tools = entry.factory();
          if (!Array.isArray(tools)) {
            failures.push(`${entry.name}: returned non-array`);
          } else {
            totalTools += tools.length;
          }
        } catch (err) {
          failures.push(`${entry.name}: ${(err as Error).message}`);
        }
      }

      if (failures.length > 0) {
        throw new Error(`${failures.length} factories failed:\n  ${failures.join('\n  ')}`);
      }
      return `${FACTORIES.length} factories loaded, ${totalTools} tools total`;
    }),
  );

  // ── Collect all tools for subsequent tests ─────────────────────────
  const allTools: Array<{ factory: string; wave: number; tool: ToolDefinition }> = [];
  for (const entry of FACTORIES) {
    try {
      const tools = entry.factory();
      for (const tool of tools) {
        allTools.push({ factory: entry.name, wave: entry.wave, tool });
      }
    } catch {
      // Already reported in T16.1
    }
  }

  // ── T16.2 — Schema Validation ──────────────────────────────────────
  tests.push(
    await runTest('T16.2', 'Tool Schema Validation', async () => {
      const failures: string[] = [];

      for (const { factory, tool } of allTools) {
        const issues: string[] = [];
        if (!tool.name || typeof tool.name !== 'string') issues.push('missing name');
        if (!tool.description || typeof tool.description !== 'string') issues.push('missing description');
        if (!tool.parameters || typeof tool.parameters !== 'object') issues.push('missing parameters');
        if (typeof tool.execute !== 'function') issues.push('missing execute function');

        // Validate parameter shapes
        if (tool.parameters) {
          for (const [pName, pDef] of Object.entries(tool.parameters)) {
            if (!pDef.type) issues.push(`param "${pName}" missing type`);
            if (!pDef.description) issues.push(`param "${pName}" missing description`);
          }
        }

        if (issues.length > 0) {
          failures.push(`${factory}/${tool.name ?? '?'}: ${issues.join(', ')}`);
        }
      }

      if (failures.length > 0) {
        throw new Error(`${failures.length} schema issues:\n  ${failures.join('\n  ')}`);
      }
      return `${allTools.length} tools validated — all have valid name, description, parameters, execute`;
    }),
  );

  // ── T16.3 — Environment Variables ──────────────────────────────────
  tests.push(
    await runTest('T16.3', 'API Environment Variables', async () => {
      const missing: string[] = [];
      const present: string[] = [];

      for (const [service, vars] of Object.entries(ENV_REQUIREMENTS)) {
        const allPresent = vars.every(v => !!process.env[v]);
        if (allPresent) {
          present.push(service);
        } else {
          const missingVars = vars.filter(v => !process.env[v]);
          missing.push(`${service}: ${missingVars.join(', ')}`);
        }
      }

      if (missing.length > 0) {
        throw new Error(
          `${missing.length}/${Object.keys(ENV_REQUIREMENTS).length} services missing env vars:\n  ${missing.join('\n  ')}` +
          `\n  Present: ${present.join(', ') || 'none'}`,
        );
      }
      return `All ${Object.keys(ENV_REQUIREMENTS).length} service credentials present`;
    }),
  );

  // ── T16.4 — Database Tables ────────────────────────────────────────
  tests.push(
    await runTest('T16.4', 'Required Database Tables Exist', async () => {
      const existing = await query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
      );
      const existingSet = new Set(existing.map(r => r.table_name));
      const missing = REQUIRED_TABLES.filter(t => !existingSet.has(t));

      if (missing.length > 0) {
        throw new Error(
          `${missing.length}/${REQUIRED_TABLES.length} tables missing: ${missing.join(', ')}`,
        );
      }
      return `All ${REQUIRED_TABLES.length} required tables exist`;
    }),
  );

  // ── T16.5 — Execute Safety ─────────────────────────────────────────
  // Group by wave for granular reporting
  for (const wave of [1, 2, 3, 4, 5]) {
    const waveTools = allTools.filter(t => t.wave === wave);
    if (waveTools.length === 0) continue;

    const waveNames = ['', 'Marketing', 'Finance', 'Product+Research', 'Governance', 'Engineering'];
    tests.push(
      await runTest(
        `T16.5${String.fromCharCode(96 + wave)}`,
        `Wave ${wave} ${waveNames[wave]} Execute Safety`,
        async () => {
          const threw: string[] = [];
          const timedOut: string[] = [];
          const badReturn: string[] = [];
          const passed: string[] = [];

          // Run all tool executions in parallel for speed
          const results = await Promise.all(
            waveTools.map(async ({ tool }) => {
              const r = await safeExecute(tool);
              return { name: tool.name, ...r };
            }),
          );

          for (const r of results) {
            if (r.threw) {
              threw.push(`${r.name}: ${r.error}`);
            } else if (r.timedOut) {
              timedOut.push(r.name);
            } else if (!r.returned) {
              badReturn.push(`${r.name}: ${r.error}`);
            } else {
              passed.push(r.name);
            }
          }

          const issues = [...threw, ...timedOut, ...badReturn];
          if (issues.length > 0) {
            const parts: string[] = [];
            if (threw.length) parts.push(`THREW (${threw.length}): ${threw.join('; ')}`);
            if (timedOut.length) parts.push(`TIMEOUT (${timedOut.length}): ${timedOut.join(', ')}`);
            if (badReturn.length) parts.push(`BAD RETURN (${badReturn.length}): ${badReturn.join('; ')}`);
            parts.push(`PASSED (${passed.length}): ${passed.join(', ')}`);
            throw new Error(parts.join('\n  '));
          }

          return `${waveTools.length} tools called with empty params — all returned valid ToolResult`;
        },
      ),
    );
  }

  // ── T16.6 — Registry Coverage ──────────────────────────────────────
  tests.push(
    await runTest('T16.6', 'KNOWN_TOOLS Registry Coverage', async () => {
      const missing: string[] = [];

      for (const { factory, tool } of allTools) {
        if (!isKnownTool(tool.name)) {
          missing.push(`${factory}/${tool.name}`);
        }
      }

      if (missing.length > 0) {
        throw new Error(
          `${missing.length} tools NOT in KNOWN_TOOLS:\n  ${missing.join('\n  ')}`,
        );
      }
      return `All ${allTools.length} tool names registered in KNOWN_TOOLS`;
    }),
  );

  // ── T16.7 — Grant Coverage ─────────────────────────────────────────
  tests.push(
    await runTest('T16.7', 'Agent Tool Grant Coverage', async () => {
      const grants = await query<{ agent_role: string; tool_name: string }>(
        `SELECT agent_role, tool_name FROM agent_tool_grants WHERE is_active = true`,
      );
      const grantSet = new Set(grants.map(g => `${g.agent_role}:${g.tool_name}`));

      const missing: string[] = [];
      for (const [agent, tools] of Object.entries(AGENT_TOOL_WIRING)) {
        for (const tool of tools) {
          if (!grantSet.has(`${agent}:${tool}`)) {
            missing.push(`${agent} → ${tool}`);
          }
        }
      }

      if (missing.length > 0) {
        throw new Error(
          `${missing.length} missing grants:\n  ${missing.join('\n  ')}`,
        );
      }

      const totalChecked = Object.values(AGENT_TOOL_WIRING).reduce((s, t) => s + t.length, 0);
      return `${totalChecked} agent→tool grants verified across ${Object.keys(AGENT_TOOL_WIRING).length} agents`;
    }),
  );

  return { layer: 16, name: 'Tool Health Check', tests };
}
