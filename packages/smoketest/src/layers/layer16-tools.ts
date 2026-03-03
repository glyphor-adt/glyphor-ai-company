/**
 * Layer 16 – Tool Health Check
 *
 * Validates that ALL shared tools load, have valid schemas, handle errors
 * gracefully, and are properly registered + granted. This catches tools that
 * crash instead of returning clean error results when agents try to use them.
 *
 * Tests:
 *   T16.1  Factory Instantiation — all factories load without throwing
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

// ── Pre-existing — Design Team ──────────────────────────────────────
import { createFigmaTools } from '@glyphor/agents/shared/figmaTools';
import { createScreenshotTools } from '@glyphor/agents/shared/screenshotTools';
import { createDesignSystemTools } from '@glyphor/agents/shared/designSystemTools';
import { createAuditTools } from '@glyphor/agents/shared/auditTools';
import { createAssetTools } from '@glyphor/agents/shared/assetTools';
import { createScaffoldTools } from '@glyphor/agents/shared/scaffoldTools';
import { createDeployPreviewTools } from '@glyphor/agents/shared/deployPreviewTools';
import { createStorybookTools } from '@glyphor/agents/shared/storybookTools';
import { createFrontendCodeTools } from '@glyphor/agents/shared/frontendCodeTools';

// ── Pre-existing — Infrastructure ───────────────────────────────────
import { createDiagnosticTools } from '@glyphor/agents/shared/diagnosticTools';
import { createAccessAuditTools } from '@glyphor/agents/shared/accessAuditTools';
import { createAgentDirectoryTools } from '@glyphor/agents/shared/agentDirectoryTools';
import { createAgentCreationTools } from '@glyphor/agents/shared/agentCreationTools';
import { createToolRegistryTools } from '@glyphor/agents/shared/toolRegistryTools';
import { createToolRequestTools } from '@glyphor/agents/shared/toolRequestTools';
import { createEmailTools } from '@glyphor/agents/shared/emailTools';
import { createSharePointTools } from '@glyphor/agents/shared/sharepointTools';
import { createResearchTools } from '@glyphor/agents/shared/researchTools';

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
  // Wave 0 — Pre-existing (Design Team)
  { name: 'figmaTools', wave: 0, factory: createFigmaTools },
  { name: 'screenshotTools', wave: 0, factory: createScreenshotTools },
  { name: 'designSystemTools', wave: 0, factory: createDesignSystemTools },
  { name: 'auditTools', wave: 0, factory: createAuditTools },
  { name: 'assetTools', wave: 0, factory: createAssetTools },
  { name: 'scaffoldTools', wave: 0, factory: createScaffoldTools },
  { name: 'deployPreviewTools', wave: 0, factory: createDeployPreviewTools },
  { name: 'storybookTools', wave: 0, factory: createStorybookTools },
  { name: 'frontendCodeTools', wave: 0, factory: createFrontendCodeTools },
  // Wave 0 — Pre-existing (Infrastructure)
  { name: 'diagnosticTools', wave: 0, factory: createDiagnosticTools },
  { name: 'accessAuditTools', wave: 0, factory: createAccessAuditTools },
  { name: 'agentDirectoryTools', wave: 0, factory: createAgentDirectoryTools },
  { name: 'agentCreationTools', wave: 0, factory: createAgentCreationTools },
  { name: 'toolRegistryTools', wave: 0, factory: createToolRegistryTools },
  { name: 'toolRequestTools', wave: 0, factory: createToolRequestTools },
  { name: 'emailTools', wave: 0, factory: createEmailTools },
  { name: 'sharepointTools', wave: 0, factory: createSharePointTools },
  { name: 'researchTools', wave: 0, factory: createResearchTools },
  // Wave 1 — Marketing
  { name: 'contentTools', wave: 1, factory: createContentTools },
  { name: 'seoTools', wave: 1, factory: createSeoTools },
  { name: 'socialMediaTools', wave: 1, factory: createSocialMediaTools },
  { name: 'emailMarketingTools', wave: 1, factory: createEmailMarketingTools },
  { name: 'marketingIntelTools', wave: 1, factory: createMarketingIntelTools },
  // Wave 2 — Finance
  { name: 'revenueTools', wave: 2, factory: createRevenueTools },
  { name: 'costManagementTools', wave: 2, factory: createCostManagementTools },
  { name: 'cashFlowTools', wave: 2, factory: createCashFlowTools },
  // Wave 3 — Product + Research
  { name: 'productAnalyticsTools', wave: 3, factory: createProductAnalyticsTools },
  { name: 'userResearchTools', wave: 3, factory: createUserResearchTools },
  { name: 'competitiveIntelTools', wave: 3, factory: createCompetitiveIntelTools },
  { name: 'roadmapTools', wave: 3, factory: createRoadmapTools },
  { name: 'researchRepoTools', wave: 3, factory: createResearchRepoTools },
  { name: 'researchMonitoringTools', wave: 3, factory: createResearchMonitoringTools },
  // Wave 4 — Governance
  { name: 'legalTools', wave: 4, factory: createLegalTools },
  { name: 'hrTools', wave: 4, factory: createHRTools },
  { name: 'opsExtensionTools', wave: 4, factory: createOpsExtensionTools },
  // Wave 5 — Engineering
  { name: 'engineeringGapTools', wave: 5, factory: createEngineeringGapTools },
];

/** Required env vars grouped by service. */
const ENV_REQUIREMENTS: Record<string, string[]> = {
  // Pre-existing
  'Figma (design)': ['FIGMA_CLIENT_ID', 'FIGMA_CLIENT_SECRET'],
  'Screenshot Service': ['SCREENSHOT_SERVICE_URL'],
  'Storybook': ['STORYBOOK_URL'],
  'Vercel (deploy previews)': ['VERCEL_DEPLOY_HOOK_URL'],
  'SendGrid (email)': ['SENDGRID_API_KEY'],
  // Wave 1-5
  'Stripe (revenue)': ['STRIPE_SECRET_KEY'],
  'Mercury (banking)': ['MERCURY_API_TOKEN'],
  'Mailchimp (email campaigns)': ['GLYPHOR_MAILCHIMP_API'],
  'Mandrill (transactional email)': ['GLYPHOR_MANDRILL_API_KEY'],
  'OpenAI (images + AI)': ['OPENAI_API_KEY'],
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
    'create_experiment', 'get_experiment_results', 'monitor_competitor_marketing',
    'get_lead_pipeline', 'get_marketing_dashboard',
  ],
  cfo: [
    'get_mrr_breakdown', 'get_subscription_details', 'get_churn_analysis',
    'get_revenue_forecast', 'get_stripe_invoices', 'get_customer_ltv',
    'get_gcp_costs', 'get_ai_model_costs', 'get_vendor_costs',
    'get_cost_anomalies', 'get_burn_rate', 'create_budget',
    'get_unit_economics', 'check_budget_status',
    'get_cash_balance', 'get_cash_flow', 'get_pending_transactions',
    'generate_financial_report', 'get_margin_analysis',
  ],
  cpo: [
    'query_analytics_events', 'get_usage_metrics', 'get_funnel_analysis',
    'get_cohort_retention', 'get_feature_usage', 'segment_users',
    'track_competitor', 'get_competitor_profile', 'compare_features',
    'track_competitor_pricing', 'monitor_competitor_launches', 'get_market_landscape',
    'update_competitor_profile',
    'create_roadmap_item', 'score_feature_rice', 'get_roadmap',
    'update_roadmap_item', 'get_feature_requests', 'manage_feature_flags',
  ],
  clo: [
    'track_regulations', 'get_compliance_status', 'update_compliance_item',
    'create_compliance_alert', 'get_contracts', 'create_contract_review',
    'flag_contract_issue', 'get_contract_renewals',
    'get_ip_portfolio', 'create_ip_filing', 'monitor_ip_infringement',
    'get_tax_calendar', 'calculate_tax_estimate', 'get_tax_research', 'review_tax_strategy',
    'audit_data_flows', 'check_data_retention',
    'get_privacy_requests', 'audit_access_permissions',
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
  for (const wave of [0, 1, 2, 3, 4, 5]) {
    const waveTools = allTools.filter(t => t.wave === wave);
    if (waveTools.length === 0) continue;

    const waveNames = ['Pre-existing', 'Marketing', 'Finance', 'Product+Research', 'Governance', 'Engineering'];
    const waveSuffix = wave === 0 ? '0' : String.fromCharCode(96 + wave);
    tests.push(
      await runTest(
        `T16.5${waveSuffix}`,
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
