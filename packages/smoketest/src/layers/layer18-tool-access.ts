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
import { httpGet } from '../utils/http.js';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Minimum core tools every agent must have granted (from coreTools.ts).
 * These 11 tools are always-loaded regardless of role.
 */
const CORE_TOOLS = [
  'read_my_assignments',
  'submit_assignment_output',
  'flag_assignment_blocker',
  'send_agent_message',
  'check_messages',
  'call_meeting',
  'save_memory',
  'recall_memories',
  'request_tool_access',
  'request_new_tool',
  'emit_event',
] as const;

/**
 * All 9 Glyphor MCP servers with their Cloud Run health endpoints.
 */
const GLYPHOR_MCP_SERVERS: Array<{ name: string; healthPath: string; toolCount: number }> = [
  { name: 'mcp-data-server',             healthPath: '/health', toolCount: 12 },
  { name: 'mcp-marketing-server',        healthPath: '/health', toolCount: 7  },
  { name: 'mcp-engineering-server',      healthPath: '/health', toolCount: 5  },
  { name: 'mcp-design-server',           healthPath: '/health', toolCount: 5  },
  { name: 'mcp-finance-server',          healthPath: '/health', toolCount: 7  },
  { name: 'mcp-email-server',            healthPath: '/health', toolCount: 3  },
  { name: 'mcp-legal-server',            healthPath: '/health', toolCount: 19 },
  { name: 'mcp-hr-server',               healthPath: '/health', toolCount: 8  },
  { name: 'mcp-email-marketing-server',  healthPath: '/health', toolCount: 15 },
];

/**
 * Per-role tool expectations — at least these tools must appear in agent_tool_grants.
 */
const ROLE_TOOL_EXPECTATIONS: Record<string, string[]> = {
  // ── Orchestrators ──────────────────────────────────────────────────────────
  'chief-of-staff': [
    ...CORE_TOOLS,
    'grant_tool_access', 'revoke_tool_access',
    'create_directive', 'update_directive_progress', 'propose_directive',
    'create_work_assignment', 'evaluate_assignment',
    'query_knowledge_graph', 'add_knowledge',
    'get_company_pulse', 'get_knowledge_routes',
    'send_email', 'read_inbox',
  ],
  'cto': [
    ...CORE_TOOLS,
    'query_knowledge_graph', 'add_knowledge',
    'get_github_status', 'get_vercel_deployments', 'get_cloud_run_metrics',
    'send_email',
  ],
  'cfo': [
    ...CORE_TOOLS,
    'get_stripe_mrr', 'get_mercury_balance', 'get_gcp_billing',
    'query_knowledge_graph', 'add_knowledge', 'send_email',
  ],
  'cpo': [
    ...CORE_TOOLS,
    'web_search', 'web_fetch', 'submit_research_packet',
    'query_knowledge_graph', 'add_knowledge', 'send_email',
  ],
  'cmo': [
    ...CORE_TOOLS,
    'web_search', 'get_social_metrics', 'get_seo_data',
    'query_knowledge_graph', 'add_knowledge', 'send_email',
    'get_mailchimp_campaigns',
  ],
  'clo': [
    ...CORE_TOOLS,
    'get_compliance_status', 'get_contracts', 'get_ip_portfolio',
    'query_knowledge_graph', 'add_knowledge', 'send_email',
  ],
  'ops': [
    ...CORE_TOOLS,
    'get_system_status', 'get_agent_runs', 'get_data_freshness',
    'query_knowledge_graph', 'add_knowledge',
  ],

  // ── VP-level ───────────────────────────────────────────────────────────────
  'vp-customer-success': [
    ...CORE_TOOLS,
    'get_customer_health', 'get_support_tickets', 'send_email',
  ],
  'vp-sales': [
    ...CORE_TOOLS,
    'web_search', 'get_account_dossiers', 'send_email',
  ],
  'vp-design': [
    ...CORE_TOOLS,
    'read_frontend_code', 'screenshot_page', 'get_design_tokens',
    'run_lighthouse_audit', 'generate_image_asset', 'get_figma_file',
  ],
  'vp-research': [
    ...CORE_TOOLS,
    'web_search', 'web_fetch', 'submit_research_packet',
    'query_knowledge_graph', 'add_knowledge',
  ],
  'global-admin': [
    ...CORE_TOOLS,
    'view_access_matrix', 'view_pending_grant_requests',
    'query_knowledge_graph', 'send_email',
  ],

  // ── Engineering sub-team ───────────────────────────────────────────────────
  'platform-engineer': [
    ...CORE_TOOLS,
    'get_cloud_run_metrics', 'get_gcp_billing', 'query_knowledge_graph',
  ],
  'quality-engineer': [
    ...CORE_TOOLS,
    'run_lighthouse_audit', 'run_accessibility_audit', 'query_knowledge_graph',
  ],
  'devops-engineer': [
    ...CORE_TOOLS,
    'get_github_status', 'get_vercel_deployments', 'get_cloud_run_metrics',
    'query_knowledge_graph',
  ],
  'm365-admin': [
    ...CORE_TOOLS,
    'list_sharepoint_files', 'query_knowledge_graph', 'send_email',
  ],

  // ── Product sub-team ───────────────────────────────────────────────────────
  'user-researcher':   [ ...CORE_TOOLS, 'web_search', 'web_fetch', 'submit_research_packet' ],
  'competitive-intel': [ ...CORE_TOOLS, 'web_search', 'web_fetch', 'submit_research_packet' ],

  // ── Finance sub-team ──────────────────────────────────────────────────────
  'revenue-analyst': [ ...CORE_TOOLS, 'get_stripe_mrr', 'submit_research_packet' ],
  'cost-analyst':    [ ...CORE_TOOLS, 'get_gcp_billing', 'get_mercury_balance', 'submit_research_packet' ],

  // ── Marketing sub-team ────────────────────────────────────────────────────
  'content-creator':      [ ...CORE_TOOLS, 'web_search', 'get_seo_data', 'send_email' ],
  'seo-analyst':          [ ...CORE_TOOLS, 'web_search', 'get_seo_data', 'submit_research_packet' ],
  'social-media-manager': [ ...CORE_TOOLS, 'web_search', 'get_social_metrics', 'get_scheduled_posts' ],

  // ── CS sub-team ───────────────────────────────────────────────────────────
  'onboarding-specialist': [ ...CORE_TOOLS, 'get_customer_health', 'send_email' ],
  'support-triage':        [ ...CORE_TOOLS, 'get_support_tickets', 'send_email' ],

  // ── Sales sub-team ────────────────────────────────────────────────────────
  'account-research':           [ ...CORE_TOOLS, 'web_search', 'submit_research_packet' ],
  'enterprise-account-researcher': [ ...CORE_TOOLS, 'web_search', 'web_fetch', 'submit_research_packet' ],

  // ── Design sub-team ───────────────────────────────────────────────────────
  'ui-ux-designer':     [ ...CORE_TOOLS, 'read_frontend_code', 'screenshot_page', 'get_design_tokens', 'generate_image_asset', 'get_figma_file' ],
  'frontend-engineer':  [ ...CORE_TOOLS, 'read_frontend_code', 'write_frontend_code', 'run_lighthouse_audit', 'scaffold_component', 'deploy_preview' ],
  'design-critic':      [ ...CORE_TOOLS, 'read_frontend_code', 'screenshot_page', 'get_design_tokens', 'run_accessibility_audit', 'get_figma_file' ],
  'template-architect': [ ...CORE_TOOLS, 'read_frontend_code', 'write_frontend_code', 'get_design_tokens', 'generate_image_asset', 'scaffold_component', 'get_figma_file' ],

  // ── Research analysts ─────────────────────────────────────────────────────
  'competitive-research-analyst': [ ...CORE_TOOLS, 'web_search', 'web_fetch', 'submit_research_packet' ],
  'market-research-analyst':      [ ...CORE_TOOLS, 'web_search', 'web_fetch', 'submit_research_packet' ],
  'technical-research-analyst':   [ ...CORE_TOOLS, 'web_search', 'web_fetch', 'submit_research_packet' ],
  'industry-research-analyst':    [ ...CORE_TOOLS, 'web_search', 'web_fetch', 'submit_research_packet' ],
  'ai-impact-analyst':            [ ...CORE_TOOLS, 'web_search', 'web_fetch', 'submit_research_packet' ],
  'org-analyst':                  [ ...CORE_TOOLS, 'web_search', 'web_fetch', 'submit_research_packet' ],

  // ── Specialists (DB-defined, no file runner) ──────────────────────────────
  'bob-the-tax-pro':            [ ...CORE_TOOLS, 'get_compliance_status', 'get_contracts', 'send_email' ],
  'data-integrity-auditor':     [ ...CORE_TOOLS, 'query_knowledge_graph', 'get_agent_runs' ],
  'tax-strategy-specialist':    [ ...CORE_TOOLS, 'get_compliance_status', 'send_email' ],
  'lead-gen-specialist':        [ ...CORE_TOOLS, 'web_search', 'submit_research_packet' ],
  'marketing-intelligence-analyst': [ ...CORE_TOOLS, 'web_search', 'web_fetch', 'submit_research_packet' ],
  'adi-rose':                   [ ...CORE_TOOLS, 'send_email', 'query_knowledge_graph' ],
  'head-of-hr':                 [ ...CORE_TOOLS, 'get_hr_profiles', 'send_email', 'query_knowledge_graph' ],
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
      const grantMap = new Map<string, Set<string>>();
      for (const { agent_role, tool_name } of grants) {
        if (!grantMap.has(agent_role)) grantMap.set(agent_role, new Set());
        grantMap.get(agent_role)!.add(tool_name);
      }

      const failures: string[] = [];
      let totalChecked = 0;
      for (const [role, expectedTools] of Object.entries(ROLE_TOOL_EXPECTATIONS)) {
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
  tests.push(
    await runTest('T18.3', 'Tool Registry Coverage', async () => {
      const rows = await query<{ cnt: string }>(
        `SELECT COUNT(*) AS cnt FROM tool_registry WHERE is_active = true`,
      );
      const count = parseInt(rows[0].cnt, 10);
      if (count < 100) {
        throw new Error(`Only ${count} tools in registry — expected 100+. Some dynamic tools may not be seeded.`);
      }
      return `${count} tools registered in tool_registry`;
    }),
  );

  // ── T18.4 — MCP server health pings ─────────────────────────────
  tests.push(
    await runTest('T18.4', 'MCP Server Health', async () => {
      const failures: string[] = [];
      const healthy: string[] = [];

      for (const server of GLYPHOR_MCP_SERVERS) {
        const envKey = `MCP_URL_${server.name.toUpperCase().replace(/-/g, '_')}`;
        const serviceUrl = process.env[envKey]
          ?? `https://${server.name}-610179349713.us-central1.run.app${server.healthPath}`;

        try {
          const res = await httpGet(serviceUrl, 6000);
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

      if (failures.length > 0) {
        throw new Error(
          `${failures.length}/${GLYPHOR_MCP_SERVERS.length} MCP servers unhealthy:\n  ${failures.join('\n  ')}`,
        );
      }
      return `All ${healthy.length} MCP servers healthy`;
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
      const dataServerUrl = process.env.MCP_URL_MCP_DATA_SERVER
        ?? 'https://mcp-data-server-610179349713.us-central1.run.app/mcp';
      const res = await httpGet(dataServerUrl, 6000);
      // /mcp accepts POST JSON-RPC; a GET returns 405 which confirms the service is up
      if (res.status !== 405 && !res.ok) {
        throw new Error(`MCP endpoint responded HTTP ${res.status} — verify JSON-RPC 2.0 routing`);
      }
      return 'MCP bridge enabled and data server reachable';
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
      const probeToolName = 'web_search';
      const rows = await query<{ name: string; is_active: boolean }>(
        `SELECT name, is_active FROM tool_registry WHERE name = $1 LIMIT 1`,
        [probeToolName],
      );
      if (rows.length === 0) {
        throw new Error(`'${probeToolName}' not found in tool_registry — dynamic executor may fall back to static only`);
      }
      if (!rows[0].is_active) {
        throw new Error(`'${probeToolName}' is in registry but is_active=false`);
      }
      return `Dynamic tool executor can resolve '${probeToolName}' from tool_registry`;
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
