/**
 * Layer 26 — Customer Slack Platform
 *
 * Validates the customer-facing Slack ingress service and the internal MCP Slack
 * server so the smoketest covers the Slack architecture paths documented in the
 * repo. These checks are optional and become blocked when the service URLs are
 * not configured in the smoketest environment.
 */

import type { LayerResult, SmokeTestConfig, TestResult } from '../types.js';
import { httpGet, httpPost } from '../utils/http.js';
import { gcloudExec, isGcloudAvailable } from '../utils/gcloud.js';

function blocked(id: string, name: string, message: string): TestResult {
  return { id, name, status: 'blocked', message, durationMs: 0 };
}

async function postJsonRpc(
  url: string,
  method: string,
  params?: Record<string, unknown>,
  headers?: Record<string, string>,
) {
  return httpPost(url, {
    jsonrpc: '2.0',
    id: 1,
    method,
    params: params ?? {},
  }, 30_000, headers);
}

export async function run(config: SmokeTestConfig): Promise<LayerResult> {
  const tests: TestResult[] = [];

  if (!config.slackAppUrl) {
    tests.push(blocked('T26.1', 'Slack App Health', 'Set SLACK_APP_URL to test the customer Slack ingress service'));
    tests.push(blocked('T26.2', 'Slack URL Verification', 'Set SLACK_APP_URL to test /slack/events challenge handling'));
    tests.push(blocked('T26.3', 'Slack Interactions Validation', 'Set SLACK_APP_URL to test /slack/interactions validation'));
    tests.push(blocked('T26.4', 'Slack OAuth Error Path', 'Set SLACK_APP_URL to test /slack/oauth error handling'));
  } else {
    tests.push(await (async (): Promise<TestResult> => {
      const start = Date.now();
      try {
        const res = await httpGet<Record<string, unknown>>(`${config.slackAppUrl}/health`);
        if (!res.ok) throw new Error(`/health returned HTTP ${res.status}`);
        return { id: 'T26.1', name: 'Slack App Health', status: 'pass', message: `Slack app healthy (${res.raw})`, durationMs: Date.now() - start };
      } catch (err) {
        return { id: 'T26.1', name: 'Slack App Health', status: 'fail', message: (err as Error).message, durationMs: Date.now() - start };
      }
    })());

    tests.push(await (async (): Promise<TestResult> => {
      const start = Date.now();
      try {
        const res = await httpPost<string>(`${config.slackAppUrl}/slack/events`, {
          type: 'url_verification',
          challenge: 'glyphor-smoketest-challenge',
        });
        if (res.status !== 200) throw new Error(`/slack/events returned HTTP ${res.status}`);
        if (!res.raw.includes('glyphor-smoketest-challenge')) {
          throw new Error('URL verification response did not echo the challenge');
        }
        return { id: 'T26.2', name: 'Slack URL Verification', status: 'pass', message: 'Slack events URL verification echoed challenge', durationMs: Date.now() - start };
      } catch (err) {
        return { id: 'T26.2', name: 'Slack URL Verification', status: 'fail', message: (err as Error).message, durationMs: Date.now() - start };
      }
    })());

    tests.push(await (async (): Promise<TestResult> => {
      const start = Date.now();
      try {
        const res = await fetch(`${config.slackAppUrl}/slack/interactions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'not_payload=1',
        });
        const body = await res.text();
        if (res.status !== 400) {
          throw new Error(`/slack/interactions returned HTTP ${res.status}: ${body}`);
        }
        return { id: 'T26.3', name: 'Slack Interactions Validation', status: 'pass', message: 'Slack interactions endpoint rejects malformed payloads with HTTP 400', durationMs: Date.now() - start };
      } catch (err) {
        return { id: 'T26.3', name: 'Slack Interactions Validation', status: 'fail', message: (err as Error).message, durationMs: Date.now() - start };
      }
    })());

    tests.push(await (async (): Promise<TestResult> => {
      const start = Date.now();
      try {
        const res = await httpGet<Record<string, unknown>>(`${config.slackAppUrl}/slack/oauth?error=access_denied`);
        if (res.status !== 400) throw new Error(`/slack/oauth error path returned HTTP ${res.status}`);
        return { id: 'T26.4', name: 'Slack OAuth Error Path', status: 'pass', message: 'Slack OAuth denial path returns HTTP 400 as expected', durationMs: Date.now() - start };
      } catch (err) {
        return { id: 'T26.4', name: 'Slack OAuth Error Path', status: 'fail', message: (err as Error).message, durationMs: Date.now() - start };
      }
    })());
  }

  if (!config.mcpSlackUrl) {
    tests.push(blocked('T26.5', 'MCP Slack Health', 'Set MCP_SLACK_URL to test the internal mcp-slack-server'));
    tests.push(blocked('T26.6', 'MCP Slack Tools List', 'Set MCP_SLACK_URL to inspect Slack MCP tools'));
    tests.push(blocked('T26.7', 'MCP Slack Read Tool Call', 'Set MCP_SLACK_URL to exercise a read-only Slack MCP tool'));
  } else {
    let authHeaders: Record<string, string> | undefined;
    if (isGcloudAvailable()) {
      try {
        const token = gcloudExec(`auth print-identity-token --audiences=${config.mcpSlackUrl}`).trim();
        if (token) authHeaders = { Authorization: `Bearer ${token}` };
      } catch {
        // Use unauthenticated calls if the service is public
      }
    }

    tests.push(await (async (): Promise<TestResult> => {
      const start = Date.now();
      try {
        const res = await httpGet<Record<string, unknown>>(`${config.mcpSlackUrl}/health`, 30_000, authHeaders);
        if (!res.ok) throw new Error(`/health returned HTTP ${res.status}`);
        return { id: 'T26.5', name: 'MCP Slack Health', status: 'pass', message: `MCP Slack server healthy (${res.raw})`, durationMs: Date.now() - start };
      } catch (err) {
        return { id: 'T26.5', name: 'MCP Slack Health', status: 'fail', message: (err as Error).message, durationMs: Date.now() - start };
      }
    })());

    tests.push(await (async (): Promise<TestResult> => {
      const start = Date.now();
      try {
        const res = await postJsonRpc(`${config.mcpSlackUrl}/mcp`, 'tools/list', {}, authHeaders);
        if (!res.ok) throw new Error(`tools/list returned HTTP ${res.status}: ${res.raw}`);
        const payload = res.data as { result?: { tools?: Array<{ name: string }> } };
        const tools = payload.result?.tools ?? [];
        const expected = [
          'list_pending_content',
          'get_routing_stats',
          'list_approvals',
          'approve_item',
          'reject_item',
          'route_content',
        ];
        const missing = expected.filter((name) => !tools.some((tool) => tool.name === name));
        if (missing.length > 0) {
          throw new Error(`Missing expected Slack MCP tools: ${missing.join(', ')}`);
        }
        return { id: 'T26.6', name: 'MCP Slack Tools List', status: 'pass', message: `${tools.length} Slack MCP tools listed`, durationMs: Date.now() - start };
      } catch (err) {
        return { id: 'T26.6', name: 'MCP Slack Tools List', status: 'fail', message: (err as Error).message, durationMs: Date.now() - start };
      }
    })());

    tests.push(await (async (): Promise<TestResult> => {
      const start = Date.now();
      try {
        const res = await postJsonRpc(
          `${config.mcpSlackUrl}/mcp`,
          'tools/call',
          { name: 'get_routing_stats', arguments: { days: '7' } },
          authHeaders,
        );
        if (!res.ok) throw new Error(`tools/call returned HTTP ${res.status}: ${res.raw}`);
        const payload = res.data as { result?: { content?: Array<{ text?: string }> }; error?: { message?: string } };
        if (payload.error) throw new Error(payload.error.message ?? 'Unknown JSON-RPC error');
        const text = payload.result?.content?.[0]?.text ?? '';
        if (!text.includes('approvals_by_status') && !text.includes('content')) {
          throw new Error('Read-only Slack MCP tool returned unexpected payload');
        }
        return { id: 'T26.7', name: 'MCP Slack Read Tool Call', status: 'pass', message: 'get_routing_stats executed successfully via MCP', durationMs: Date.now() - start };
      } catch (err) {
        return { id: 'T26.7', name: 'MCP Slack Read Tool Call', status: 'fail', message: (err as Error).message, durationMs: Date.now() - start };
      }
    })());
  }

  return { layer: 26, name: 'Slack Platform', tests };
}
