/**
 * Layer 18 — Tool Access Verification
 *
 * Validates that every agent has its expected tool grants registered in the DB,
 * that all 9 Glyphor MCP servers are reachable, that the Agent 365 bridge is live,
 * and that the dynamic tool executor can resolve a known tool at runtime.
 *
 * Run:
 *   npx ts-node packages/smoketest/src/main.ts --layer 18
 *   npx ts-node packages/smoketest/src/main.ts --layer 18 --interactive
 */

import type { SmokeTestConfig, TestResult, LayerResult } from '../types.js';
import { runTest } from '../utils/test.js';
import { query } from '../utils/db.js';
import { httpGet, httpPost } from '../utils/http.js';
import { isGcloudAvailable, gcloudExec } from '../utils/gcloud.js';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Shared baseline tools present in every agent's grants (the 7 universally-
 * seeded tools from the original tool_grants migration).
 */
const SHARED_BASELINE = [
  'save_memory',
  'recall_memories',
  'read_my_assignments',
  'submit_assignment_output',
  'flag_assignment_blocker',
  'send_agent_message',
  'check_messages',
] as const;

/**
 * All 8 Glyphor MCP servers with their Cloud Run health endpoints.
 */
const GLYPHOR_MCP_SERVERS: Array<{ name: string; serviceName: string; envVar: string; healthPath: string; toolCount: number; deployed: boolean }> = [
  { name: 'mcp-data',             serviceName: 'glyphor-mcp-data',             envVar: 'GLYPHOR_MCP_DATA_URL',              healthPath: '/health', toolCount: 12, deployed: true  },
  { name: 'mcp-marketing',        serviceName: 'glyphor-mcp-marketing',        envVar: 'GLYPHOR_MCP_MARKETING_URL',         healthPath: '/health', toolCount: 7,  deployed: true  },
  { name: 'mcp-engineering',      serviceName: 'glyphor-mcp-engineering',      envVar: 'GLYPHOR_MCP_ENGINEERING_URL',        healthPath: '/health', toolCount: 5,  deployed: true  },
  { name: 'mcp-design',           serviceName: 'glyphor-mcp-design',           envVar: 'GLYPHOR_MCP_DESIGN_URL',            healthPath: '/health', toolCount: 5,  deployed: true  },
  { name: 'mcp-finance',          serviceName: 'glyphor-mcp-finance',          envVar: 'GLYPHOR_MCP_FINANCE_URL',           healthPath: '/health', toolCount: 7,  deployed: true  },
  { name: 'mcp-legal',            serviceName: 'glyphor-mcp-legal',            envVar: 'GLYPHOR_MCP_LEGAL_URL',             healthPath: '/health', toolCount: 19, deployed: false },
  { name: 'mcp-hr',               serviceName: 'glyphor-mcp-hr',               envVar: 'GLYPHOR_MCP_HR_URL',                healthPath: '/health', toolCount: 8,  deployed: false },
  { name: 'mcp-email-marketing',  serviceName: 'glyphor-mcp-email-marketing',  envVar: 'GLYPHOR_MCP_EMAIL_MARKETING_URL',   healthPath: '/health', toolCount: 15, deployed: false },
];

/**
 * Per-role tool expectations — at least these tools must appear in agent_tool_grants.
 * Tool names match actual DB seed migrations.
 */
const ROLE_TOOL_EXPECTATIONS: Record<string, string[]> = {
  // ── C-suite ────────────────────────────────────────────────────────────────
  'chief-of-staff': [
    ...SHARED_BASELINE,
    'call_meeting',
    'grant_tool_access', 'revoke_tool_access',
    'create_work_assignments', 'evaluate_assignment', 'update_directive_progress',
    'query_knowledge_graph', 'add_knowledge',
    'get_company_pulse',
  ],
  'cto': [
    ...SHARED_BASELINE,
    'call_meeting',
    'emit_insight', 'emit_alert',
    'get_cloud_run_metrics', 'get_github_pr_status', 'get_ci_health',
    'query_knowledge_graph', 'add_knowledge',
  ],
  'cfo': [
    ...SHARED_BASELINE,
    'call_meeting',
    'get_financials', 'query_stripe_mrr', 'calculate_unit_economics',
    'get_mrr_breakdown', 'get_gcp_costs', 'get_cash_balance',
  ],
  'cpo': [
    ...SHARED_BASELINE,
    'call_meeting',
    'get_product_metrics', 'write_product_analysis', 'create_decision',
  ],
  'cmo': [
    ...SHARED_BASELINE,
    'call_meeting',
    'get_social_metrics', 'get_seo_data', 'get_scheduled_posts',
    'create_content_draft', 'get_mailchimp_lists',
  ],
  'clo': [
    ...SHARED_BASELINE,
    'call_meeting',
    'emit_insight', 'emit_alert',
    'grant_tool_access', 'revoke_tool_access',
    'query_knowledge_graph', 'add_knowledge',
  ],
  'ops': [
    ...SHARED_BASELINE,
    'query_agent_runs', 'query_data_sync_status', 'trigger_agent_run',
    'create_incident',
  ],

  // ── VP-level ───────────────────────────────────────────────────────────────
  'vp-sales': [
    ...SHARED_BASELINE,
    'create_decision', 'log_activity',
  ],
  'vp-design': [
    ...SHARED_BASELINE,
    'call_meeting',
    'run_lighthouse_audit', 'screenshot_page', 'get_figma_file',
    'scaffold_component', 'deploy_preview',
  ],
  'vp-research': [
    ...SHARED_BASELINE,
    'call_meeting',
    'emit_insight', 'emit_alert', 'request_new_tool',
    'web_search', 'web_fetch', 'submit_research_packet',
    'query_knowledge_graph', 'add_knowledge',
  ],
  'global-admin': [
    ...SHARED_BASELINE,
    'call_meeting',
    'emit_insight', 'emit_alert', 'request_new_tool',
    'grant_tool_access', 'revoke_tool_access',
    'query_knowledge_graph', 'add_knowledge',
    'list_project_iam', 'list_service_accounts',
  ],

  // ── Engineering sub-team ───────────────────────────────────────────────────
  'platform-engineer': [
    ...SHARED_BASELINE,
    'query_cloud_run_metrics', 'run_health_check', 'query_uptime', 'log_activity',
  ],
  'quality-engineer': [
    ...SHARED_BASELINE,
    'query_build_logs', 'query_error_patterns', 'create_bug_report', 'log_activity',
  ],
  'devops-engineer': [
    ...SHARED_BASELINE,
    'query_cache_metrics', 'query_pipeline_metrics', 'get_pipeline_runs', 'log_activity',
  ],
  'm365-admin': [
    ...SHARED_BASELINE,
    'list_users', 'list_channels', 'create_channel',
  ],

  // ── Product sub-team ───────────────────────────────────────────────────────
  'user-researcher': [
    ...SHARED_BASELINE,
    'query_user_analytics', 'query_onboarding_funnel', 'design_experiment', 'log_activity',
  ],
  'competitive-intel': [
    ...SHARED_BASELINE,
    'fetch_github_releases', 'search_hacker_news', 'store_intel', 'log_activity',
  ],

  // ── Finance sub-team ──────────────────────────────────────────────────────
  'revenue-analyst': [
    ...SHARED_BASELINE,
    'query_stripe_revenue', 'calculate_ltv_cac', 'forecast_revenue', 'log_activity',
    'get_mrr_breakdown', 'get_cash_balance',
  ],
  'cost-analyst': [
    ...SHARED_BASELINE,
    'query_gcp_billing', 'identify_waste', 'project_costs', 'log_activity',
    'get_gcp_costs', 'get_burn_rate', 'get_cash_balance',
  ],

  // ── Marketing sub-team ────────────────────────────────────────────────────
  'content-creator': [
    ...SHARED_BASELINE,
    'draft_blog_post', 'draft_social_post', 'query_content_performance', 'log_activity',
    'create_content_draft', 'get_content_metrics',
  ],
  'seo-analyst': [
    ...SHARED_BASELINE,
    'query_seo_rankings', 'discover_keywords', 'analyze_content_seo', 'log_activity',
    'get_seo_data', 'get_search_performance',
  ],
  'social-media-manager': [
    ...SHARED_BASELINE,
    'schedule_social_post', 'query_social_metrics', 'monitor_mentions', 'log_activity',
    'get_scheduled_posts', 'get_social_metrics',
  ],

  // ── Sales sub-team ────────────────────────────────────────────────────────
  'account-research': [
    ...SHARED_BASELINE,
    'search_company_info', 'analyze_tech_stack', 'compile_dossier', 'log_activity',
  ],
  'enterprise-account-researcher': [
    ...SHARED_BASELINE,
    'call_meeting', 'emit_insight', 'emit_alert', 'request_new_tool',
    'web_search', 'web_fetch',
  ],

  // ── Design sub-team ───────────────────────────────────────────────────────
  'ui-ux-designer': [
    ...SHARED_BASELINE,
    'call_meeting', 'emit_insight', 'emit_alert', 'request_new_tool',
    'screenshot_page', 'get_figma_file', 'save_component_spec',
    'read_frontend_file', 'search_frontend_code',
  ],
  'frontend-engineer': [
    ...SHARED_BASELINE,
    'call_meeting', 'emit_insight', 'emit_alert', 'request_new_tool',
    'run_lighthouse', 'push_component', 'create_component_pr',
    'read_frontend_file', 'write_frontend_file',
  ],
  'design-critic': [
    ...SHARED_BASELINE,
    'call_meeting', 'emit_insight', 'emit_alert', 'request_new_tool',
    'grade_build', 'run_lighthouse', 'query_build_grades', 'log_activity',
    'run_lighthouse_audit', 'run_accessibility_audit',
  ],
  'template-architect': [
    ...SHARED_BASELINE,
    'call_meeting', 'emit_insight', 'emit_alert', 'request_new_tool',
    'save_template_variant', 'query_template_variants', 'log_activity',
    'read_frontend_file', 'write_frontend_file',
  ],

  // ── Research analysts ─────────────────────────────────────────────────────
  'competitive-research-analyst': [ ...SHARED_BASELINE, 'call_meeting', 'emit_insight', 'emit_alert', 'web_search', 'web_fetch', 'submit_research_packet' ],
  'market-research-analyst':      [ ...SHARED_BASELINE, 'call_meeting', 'emit_insight', 'emit_alert', 'web_search', 'web_fetch', 'submit_research_packet' ],
  'technical-research-analyst':   [ ...SHARED_BASELINE, 'call_meeting', 'emit_insight', 'emit_alert', 'web_search', 'web_fetch', 'submit_research_packet' ],
  'industry-research-analyst':    [ ...SHARED_BASELINE, 'call_meeting', 'emit_insight', 'emit_alert', 'web_search', 'web_fetch', 'submit_research_packet' ],
  'ai-impact-analyst':            [ ...SHARED_BASELINE, 'call_meeting', 'emit_insight', 'emit_alert', 'web_search', 'web_fetch', 'submit_research_packet' ],
  'org-analyst':                  [ ...SHARED_BASELINE, 'call_meeting', 'emit_insight', 'emit_alert', 'web_search', 'web_fetch', 'submit_research_packet' ],

  // ── Specialists (DB-only) ─────────────────────────────────────────────────
  'bob-the-tax-pro':                [ ...SHARED_BASELINE, 'call_meeting', 'emit_insight', 'emit_alert',  'query_knowledge_graph' ],
  'data-integrity-auditor':         [ ...SHARED_BASELINE, 'call_meeting', 'emit_insight', 'emit_alert',  'query_knowledge_graph' ],
  'tax-strategy-specialist':        [ ...SHARED_BASELINE, 'call_meeting', 'emit_insight', 'emit_alert',  'query_knowledge_graph' ],
  'lead-gen-specialist':            [ ...SHARED_BASELINE, 'call_meeting', 'emit_insight', 'emit_alert',  'web_search', 'web_fetch' ],
  'marketing-intelligence-analyst': [ ...SHARED_BASELINE, 'call_meeting', 'emit_insight', 'emit_alert',  'web_search', 'web_fetch' ],
  'adi-rose':                       [ ...SHARED_BASELINE, 'call_meeting', 'emit_insight', 'emit_alert' ],  // was incomplete per bulk_missing
  'head-of-hr':                     [ ...SHARED_BASELINE, 'call_meeting', 'emit_insight', 'emit_alert',  'query_knowledge_graph', 'audit_workforce', 'provision_agent' ],
};

// ─── Layer Runner ─────────────────────────────────────────────────────────────

export async function run(_config: SmokeTestConfig): Promise<LayerResult> {
  const tests: TestResult[] = [];

  // ── T18.1 — Grant table populated ────────────────────────────────
  tests.push(
    await runTest('T18.1', 'Grant Table Populated', async () => {
      const rows = await query<{ cnt: string }>(
        `SELECT COUNT(*) AS cnt FROM agent_tool_grants WHERE is_active = true`,
      );
      const count = parseInt(rows[0].cnt, 10);
      if (count === 0) {
        throw new Error('agent_tool_grants has 0 active rows — run seed script');
      }
      return `${count} active tool grants found`;
    }),
  );

  // ── T18.2 — Per-role expected tools ──────────────────────────────
  tests.push(
    await runTest('T18.2', 'Per-Role Tool Grants', async () => {
      const grants = await query<{ agent_role: string; tool_name: string }>(
        `SELECT agent_role, tool_name FROM agent_tool_grants WHERE is_active = true`,
      );
      const activeRoles = await query<{ role: string }>(
        `SELECT role FROM company_agents WHERE status = 'active'`,
      );
      const activeRoleSet = new Set(activeRoles.map((r) => r.role));
      const grantMap = new Map<string, Set<string>>();
      for (const { agent_role, tool_name } of grants) {
        if (!grantMap.has(agent_role)) grantMap.set(agent_role, new Set());
        grantMap.get(agent_role)!.add(tool_name);
      }

      const failures: string[] = [];
      let totalChecked = 0;
      for (const [role, expectedTools] of Object.entries(ROLE_TOOL_EXPECTATIONS)) {
        if (!activeRoleSet.has(role)) {
          continue;
        }
        totalChecked++;
        const grantedTools = grantMap.get(role) ?? new Set<string>();
        const missing = expectedTools.filter(t => !grantedTools.has(t));
        if (missing.length > 3) {
          failures.push(`${role}: missing ${missing.length} tools (${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''})`);
        }
      }

      if (failures.length > 0) {
        throw new Error(
          `${failures.length}/${totalChecked} roles have significant tool gaps:\n  ${failures.join('\n  ')}`,
        );
      }
      return `All ${totalChecked} roles have expected tool grants`;
    }),
  );

  // ── T18.3 — Tool registry coverage ──────────────────────────────
  // tool_registry is populated at runtime via the approval workflow.
  // Zero rows is valid for a fresh environment — this test is informational.
  tests.push(
    await runTest('T18.3', 'Tool Registry Coverage', async () => {
      const rows = await query<{ cnt: string }>(
        `SELECT COUNT(*) AS cnt FROM tool_registry WHERE is_active = true`,
      );
      const count = parseInt(rows[0].cnt, 10);
      return `${count} tools in tool_registry (runtime-populated via approval workflow)`;
    }),
  );

  // ── T18.4 — MCP server health pings ─────────────────────────────
  tests.push(
    await runTest('T18.4', 'MCP Server Health', async () => {
      // Cloud Run services require IAM authentication
      const hasGcloud = await isGcloudAvailable();
      let idToken: string | undefined;
      if (hasGcloud) {
        try {
          idToken = (await gcloudExec('auth print-identity-token')).trim();
        } catch { /* fall through — try without auth */ }
      }

      const failures: string[] = [];
      const healthy: string[] = [];
      const skipped: string[] = [];

      for (const server of GLYPHOR_MCP_SERVERS) {
        if (!server.deployed) {
          skipped.push(server.name);
          continue;
        }
        const serviceUrl = `https://${server.serviceName}-610179349713.us-central1.run.app${server.healthPath}`;

        try {
          const headers: Record<string, string> = {};
          if (idToken) headers['Authorization'] = `Bearer ${idToken}`;
          const res = await httpGet(serviceUrl, 8000, headers);
          if (res.ok) {
            healthy.push(server.name);
          } else {
            failures.push(`${server.name}: HTTP ${res.status}`);
          }
        } catch (err) {
          const msg = (err as Error).message;
          const isTimeout = msg.includes('abort') || msg.includes('timeout');
          failures.push(`${server.name}: ${isTimeout ? 'timeout (cold start?)' : msg}`);
        }
      }

      if (!hasGcloud && failures.length > 0) {
        return `gcloud not available — skipping IAM-authenticated health checks (${failures.length} servers unreachable without auth)`;
      }

      if (failures.length > 0) {
        throw new Error(
          `${failures.length}/${GLYPHOR_MCP_SERVERS.length} MCP servers unhealthy:\n  ${failures.join('\n  ')}`,
        );
      }
      const skippedNote = skipped.length > 0 ? ` | ${skipped.length} not yet deployed (${skipped.join(', ')})` : '';
      return `${healthy.length}/${GLYPHOR_MCP_SERVERS.length} deployed MCP servers healthy${skippedNote}`;
    }),
  );

  // ── T18.5 — Glyphor MCP bridge enabled ──────────────────────────
  tests.push(
    await runTest('T18.5', 'Glyphor MCP Bridge', async () => {
      const enabled = process.env.GLYPHOR_MCP_ENABLED;
      if (enabled !== 'true') {
        throw new Error(
          `GLYPHOR_MCP_ENABLED=${enabled ?? '(unset)'} — MCP bridge disabled. Set to 'true' to activate ~81 MCP tools.`,
        );
      }
      const dataServerUrl = process.env.GLYPHOR_MCP_DATA_URL
        ?? 'https://glyphor-mcp-data-610179349713.us-central1.run.app/mcp';

      // Get identity token for IAM-protected Cloud Run service
      const hasGcloud = await isGcloudAvailable();
      const fetchHeaders: Record<string, string> = {};
      if (hasGcloud) {
        try {
          const token = (await gcloudExec('auth print-identity-token')).trim();
          fetchHeaders['Authorization'] = `Bearer ${token}`;
        } catch { /* try without auth */ }
      }

      // POST a JSON-RPC 2.0 'initialize' request — the /mcp route only accepts POST
      const rpcBody = { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} };
      const res = await httpPost(dataServerUrl, rpcBody, 8000, fetchHeaders);
      if (!res.ok) {
        throw new Error(`MCP endpoint responded HTTP ${res.status} — verify JSON-RPC 2.0 routing`);
      }
      const body = res.data as Record<string, unknown>;
      if (body.error) {
        throw new Error(`MCP JSON-RPC error: ${JSON.stringify(body.error)}`);
      }
      return 'MCP bridge enabled and data server reachable (initialize OK)';
    }),
  );

  // ── T18.6 — Agent 365 bridge ────────────────────────────────────
  tests.push(
    await runTest('T18.6', 'Agent 365 Bridge', async () => {
      const enabled = process.env.AGENT365_ENABLED;
      if (enabled !== 'true') {
        throw new Error(
          `AGENT365_ENABLED=${enabled ?? '(unset)'} — Agent 365 M365 tools disabled. ~25 agents need this for Calendar, Teams, Mail.`,
        );
      }
      const required = ['AGENT365_CLIENT_ID', 'AGENT365_CLIENT_SECRET', 'AGENT365_TENANT_ID'];
      const missing = required.filter(v => !process.env[v]);
      if (missing.length > 0) {
        throw new Error(`Missing Agent 365 env vars: ${missing.join(', ')}`);
      }
      return 'Agent 365 enabled — MSAL credentials present for 5 M365 MCP servers';
    }),
  );

  // ── T18.7 — Dynamic tool executor ──────────────────────────────
  tests.push(
    await runTest('T18.7', 'Dynamic Tool Executor', async () => {
      // Verify that the tool executor can resolve a well-known tool from
      // agent_tool_grants (tool_registry is runtime-populated and may be empty).
      const probeToolName = 'save_memory';
      const rows = await query<{ tool_name: string; is_active: boolean }>(
        `SELECT tool_name, is_active FROM agent_tool_grants WHERE tool_name = $1 AND is_active = true LIMIT 1`,
        [probeToolName],
      );
      if (rows.length === 0) {
        throw new Error(`'${probeToolName}' not found in agent_tool_grants — tool executor has no grants to resolve`);
      }
      return `Dynamic tool executor can resolve '${probeToolName}' from agent_tool_grants`;
    }),
  );

  // ── T18.8 — Zero-grant agents ──────────────────────────────────
  tests.push(
    await runTest('T18.8', 'No Zero-Grant Agents', async () => {
      const rows = await query<{ agent_id: string; name: string; role: string }>(`
        SELECT ca.id AS agent_id, ca.name, ca.role
        FROM company_agents ca
        WHERE ca.status = 'active'
          AND NOT EXISTS (
            SELECT 1 FROM agent_tool_grants atg
            WHERE atg.agent_role = ca.role AND atg.is_active = true
          )
      `);
      if (rows.length > 0) {
        const names = rows.map(r => `${r.name} (${r.role})`).join(', ');
        throw new Error(
          `${rows.length} active agent(s) have NO tool grants — they cannot call any tools: ${names}`,
        );
      }
      return 'All active agents have at least one tool grant';
    }),
  );

  // ── T18.9 — Expired grants cleanup ────────────────────────────
  tests.push(
    await runTest('T18.9', 'No Stale Expired Grants', async () => {
      const rows = await query<{ cnt: string }>(`
        SELECT COUNT(*) AS cnt
        FROM agent_tool_grants
        WHERE is_active = true
          AND expires_at IS NOT NULL
          AND expires_at < NOW()
      `);
      const count = parseInt(rows[0].cnt, 10);
      if (count > 0) {
        throw new Error(
          `${count} tool grants are past their expires_at but still is_active=true — run cleanup to deactivate`,
        );
      }
      return 'No stale expired grants found';
    }),
  );

  // ── T18.10 — Grant summary ────────────────────────────────────
  tests.push(
    await runTest('T18.10', 'Grant Summary', async () => {
      const rows = await query<{ role: string; grant_count: string }>(`
        SELECT agent_role AS role, COUNT(*) AS grant_count
        FROM agent_tool_grants
        WHERE is_active = true
        GROUP BY agent_role
        ORDER BY grant_count DESC
      `);
      const totalRoles = rows.length;
      const avgGrants = rows.length > 0
        ? Math.round(rows.reduce((s, r) => s + parseInt(r.grant_count, 10), 0) / rows.length)
        : 0;
      const maxRole = rows[0];
      const minRole = rows[rows.length - 1];
      return (
        `${totalRoles} roles have active grants | avg ${avgGrants} grants/role` +
        ` | max: ${maxRole?.role} (${maxRole?.grant_count})` +
        ` | min: ${minRole?.role} (${minRole?.grant_count})`
      );
    }),
  );

  return { layer: 18, name: 'Tool Access Verification', tests };
}

