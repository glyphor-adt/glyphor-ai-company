/**
 * Layer 17 – MCP Server Health Check
 *
 * Validates that all five Glyphor MCP servers are reachable, return tools via
 * the JSON-RPC `tools/list` method, have valid tool schemas, and can execute
 * each tool with empty parameters without crashing.
 *
 * Tests:
 *   T17.1  Server Health — /health endpoint returns 200 on every server
 *   T17.2  Tools List — tools/list returns a non-empty array of tools per server
 *   T17.3  Schema Validation — every tool has name, description, inputSchema
 *   T17.4  Tool Execution — tools/call with empty args returns a result (not crash)
 *   T17.5  Expected Tool Counts — each server exposes the expected number of tools
 */

import type { SmokeTestConfig, TestResult, LayerResult } from '../types.js';
import { runTest } from '../utils/test.js';
import { gcloudExec, isGcloudAvailable } from '../utils/gcloud.js';

// ── MCP Server definitions ──────────────────────────────────────

interface McpServerDef {
  name: string;
  envVar: string;
  expectedMinTools: number;
  expectedToolNames: string[];
}

const MCP_SERVERS: McpServerDef[] = [
  {
    name: 'mcp-data-server',
    envVar: 'GLYPHOR_MCP_DATA_URL',
    expectedMinTools: 12,
    expectedToolNames: [
      'query_content_drafts', 'query_content_metrics', 'query_seo_data',
      'query_financials', 'query_company_pulse', 'query_analytics_events',
      'query_support_tickets', 'query_company_research', 'query_agent_runs',
      'query_agent_activities', 'query_incidents', 'query_data_sync_status',
    ],
  },
  {
    name: 'mcp-finance-server',
    envVar: 'GLYPHOR_MCP_FINANCE_URL',
    expectedMinTools: 7,
    expectedToolNames: [
      'query_stripe_data', 'query_gcp_billing', 'query_cost_metrics',
      'query_api_billing', 'query_infrastructure_costs', 'query_financials',
      'query_company_pulse',
    ],
  },
  {
    name: 'mcp-marketing-server',
    envVar: 'GLYPHOR_MCP_MARKETING_URL',
    expectedMinTools: 7,
    expectedToolNames: [
      'query_content_drafts', 'query_content_metrics', 'query_seo_data',
      'query_scheduled_posts', 'query_social_metrics', 'query_email_metrics',
      'query_experiment_designs',
    ],
  },
  {
    name: 'mcp-engineering-server',
    envVar: 'GLYPHOR_MCP_ENGINEERING_URL',
    expectedMinTools: 5,
    expectedToolNames: [
      'query_infrastructure_metrics', 'query_incidents', 'query_agent_runs',
      'query_data_sync_status', 'query_analytics_events',
    ],
  },
  {
    name: 'mcp-design-server',
    envVar: 'GLYPHOR_MCP_DESIGN_URL',
    expectedMinTools: 5,
    expectedToolNames: [
      'query_design_reviews', 'query_design_assets', 'query_failed_reviews',
      'query_figma_assets', 'query_review_scores',
    ],
  },
];

// ── JSON-RPC helpers ────────────────────────────────────────────

interface McpTool {
  name: string;
  description?: string;
  inputSchema?: { type: string; properties?: Record<string, unknown> };
}

interface JsonRpcResponse {
  jsonrpc: string;
  id: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

/** Get the base URL (strip /mcp suffix) for health checks. */
function baseUrl(mcpUrl: string): string {
  return mcpUrl.replace(/\/mcp\/?$/, '');
}

/** Send a JSON-RPC request to an MCP server. */
async function rpcCall(
  url: string,
  method: string,
  params?: Record<string, unknown>,
  token?: string,
  timeoutMs = 15_000,
): Promise<JsonRpcResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method,
        params: params ?? {},
      }),
      signal: controller.signal,
    });

    return (await resp.json()) as JsonRpcResponse;
  } finally {
    clearTimeout(timer);
  }
}

/** Resolve server URL from env var; returns null if not configured. */
function getServerUrl(envVar: string): string | null {
  const url = process.env[envVar];
  return url && url.length > 0 ? url : null;
}

// ── Layer runner ────────────────────────────────────────────────

export async function run(_config: SmokeTestConfig): Promise<LayerResult> {
  const tests: TestResult[] = [];

  // Resolve which servers are configured
  const servers = MCP_SERVERS.map(s => ({
    ...s,
    url: getServerUrl(s.envVar),
  }));

  const configured = servers.filter(s => s.url);
  const missing = servers.filter(s => !s.url);

  // Try to get a GCP identity token for authenticated Cloud Run calls
  let identityToken: string | undefined;
  if (isGcloudAvailable()) {
    try {
      identityToken = gcloudExec('auth print-identity-token');
    } catch {
      // Will use unauthenticated calls (works for public services)
    }
  }

  // ── T17.1 — Server Health ──────────────────────────────────────
  tests.push(
    await runTest('T17.1', 'MCP Server Health Endpoints', async () => {
      if (configured.length === 0) {
        throw new Error(
          `No MCP servers configured. Set env vars: ${MCP_SERVERS.map(s => s.envVar).join(', ')}`,
        );
      }

      const results: string[] = [];
      const failures: string[] = [];

      for (const server of configured) {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 10_000);

          const headers: Record<string, string> = {};
          if (identityToken) headers['Authorization'] = `Bearer ${identityToken}`;

          const resp = await fetch(`${baseUrl(server.url!)}/health`, {
            signal: controller.signal,
            headers,
          });
          clearTimeout(timer);

          if (resp.ok) {
            results.push(`${server.name}: OK`);
          } else {
            failures.push(`${server.name}: HTTP ${resp.status}`);
          }
        } catch (err) {
          failures.push(`${server.name}: ${(err as Error).message}`);
        }
      }

      if (missing.length > 0) {
        results.push(`(${missing.length} not configured: ${missing.map(s => s.name).join(', ')})`);
      }

      if (failures.length > 0) {
        throw new Error(
          `${failures.length}/${configured.length} servers unhealthy:\n  ${failures.join('\n  ')}` +
          (results.length > 0 ? `\n  Healthy: ${results.join(', ')}` : ''),
        );
      }

      return `${configured.length}/${MCP_SERVERS.length} servers healthy`;
    }),
  );

  // ── T17.2 — Tools List ─────────────────────────────────────────
  // Store for use in subsequent tests
  const serverTools = new Map<string, McpTool[]>();

  tests.push(
    await runTest('T17.2', 'MCP tools/list Returns Tools', async () => {
      if (configured.length === 0) throw new Error('No servers configured');

      const results: string[] = [];
      const failures: string[] = [];

      for (const server of configured) {
        try {
          const resp = await rpcCall(server.url!, 'tools/list', {}, identityToken);
          if (resp.error) {
            failures.push(`${server.name}: RPC error ${resp.error.code} — ${resp.error.message}`);
            continue;
          }

          const tools = resp.result as McpTool[];
          if (!Array.isArray(tools) || tools.length === 0) {
            failures.push(`${server.name}: returned empty or non-array tools`);
            continue;
          }

          serverTools.set(server.name, tools);
          results.push(`${server.name}: ${tools.length} tools`);
        } catch (err) {
          failures.push(`${server.name}: ${(err as Error).message}`);
        }
      }

      if (failures.length > 0) {
        throw new Error(
          `${failures.length} servers failed tools/list:\n  ${failures.join('\n  ')}`,
        );
      }

      return results.join(', ');
    }),
  );

  // ── T17.3 — Schema Validation ──────────────────────────────────
  tests.push(
    await runTest('T17.3', 'MCP Tool Schema Validation', async () => {
      const issues: string[] = [];
      let totalTools = 0;

      for (const [serverName, tools] of serverTools) {
        for (const tool of tools) {
          totalTools++;
          const problems: string[] = [];

          if (!tool.name || typeof tool.name !== 'string') problems.push('missing name');
          if (!tool.description || typeof tool.description !== 'string') problems.push('missing description');
          if (!tool.inputSchema) problems.push('missing inputSchema');
          else if (tool.inputSchema.type !== 'object') problems.push(`inputSchema.type = "${tool.inputSchema.type}" (expected "object")`);

          if (problems.length > 0) {
            issues.push(`${serverName}/${tool.name ?? '?'}: ${problems.join(', ')}`);
          }
        }
      }

      if (totalTools === 0) {
        throw new Error('No tools to validate — tools/list may have failed');
      }

      if (issues.length > 0) {
        throw new Error(`${issues.length}/${totalTools} schema issues:\n  ${issues.join('\n  ')}`);
      }

      return `${totalTools} tools across ${serverTools.size} servers — all schemas valid`;
    }),
  );

  // ── T17.4 — Tool Execution ─────────────────────────────────────
  for (const server of configured) {
    const tools = serverTools.get(server.name);
    if (!tools || tools.length === 0) continue;

    tests.push(
      await runTest(
        `T17.4-${server.name}`,
        `${server.name} Tool Execution`,
        async () => {
          const passed: string[] = [];
          const failures: string[] = [];

          for (const tool of tools) {
            try {
              const resp = await rpcCall(
                server.url!,
                'tools/call',
                { name: tool.name, arguments: {} },
                identityToken,
                20_000,
              );

              if (resp.error) {
                // RPC errors are acceptable for missing params — as long as
                // it's a clean error response, not a crash
                if (resp.error.code === -32602) {
                  passed.push(tool.name);  // clean param validation error
                } else {
                  failures.push(`${tool.name}: RPC ${resp.error.code} — ${resp.error.message}`);
                }
              } else {
                passed.push(tool.name);
              }
            } catch (err) {
              failures.push(`${tool.name}: ${(err as Error).message}`);
            }
          }

          if (failures.length > 0) {
            throw new Error(
              `${failures.length}/${tools.length} tools failed:\n  ${failures.join('\n  ')}` +
              `\n  Passed: ${passed.join(', ')}`,
            );
          }

          return `${tools.length} tools executed — all returned clean responses`;
        },
      ),
    );
  }

  // ── T17.5 — Expected Tool Counts ───────────────────────────────
  tests.push(
    await runTest('T17.5', 'Expected Tool Counts & Names', async () => {
      const issues: string[] = [];

      for (const server of MCP_SERVERS) {
        const tools = serverTools.get(server.name);
        if (!tools) {
          if (configured.some(s => s.name === server.name)) {
            issues.push(`${server.name}: tools/list returned nothing`);
          }
          continue;
        }

        // Check minimum tool count
        if (tools.length < server.expectedMinTools) {
          issues.push(
            `${server.name}: ${tools.length} tools (expected >= ${server.expectedMinTools})`,
          );
        }

        // Check expected tool names are present
        const toolNames = new Set(tools.map(t => t.name));
        const missingTools = server.expectedToolNames.filter(n => !toolNames.has(n));
        if (missingTools.length > 0) {
          issues.push(
            `${server.name} missing tools: ${missingTools.join(', ')}`,
          );
        }
      }

      if (issues.length > 0) {
        throw new Error(issues.join('\n  '));
      }

      const totalTools = [...serverTools.values()].reduce((s, t) => s + t.length, 0);
      return `${totalTools} tools across ${serverTools.size} servers — all expected tools present`;
    }),
  );

  return { layer: 17, name: 'MCP Server Health Check', tests };
}
