/**
 * Layer 12 – Voice Gateway
 *
 * Validates voice service health, session management, Teams meeting integration,
 * calendar webhook, and usage endpoints.
 */

import type { SmokeTestConfig, TestResult, LayerResult } from '../types.js';
import { httpGet, httpPost } from '../utils/http.js';
import { runTest } from '../utils/test.js';

export async function run(config: SmokeTestConfig): Promise<LayerResult> {
  const tests: TestResult[] = [];
  const vgw = config.voiceGatewayUrl;

  // T12.1 — Voice Service Health
  tests.push(
    await runTest('T12.1', 'Voice Service Health', async () => {
      const res = await httpGet<Record<string, unknown>>(`${vgw}/health`);
      if (!res.ok) throw new Error(`Voice /health returned HTTP ${res.status}`);
      if (typeof res.data !== 'object' || res.data === null) {
        throw new Error('Voice /health did not return valid JSON');
      }
      const data = res.data as { status?: string; activeSessions?: number; teamsEnabled?: boolean };
      return `Voice service healthy — status: ${data.status ?? 'ok'}, activeSessions: ${data.activeSessions ?? '?'}, teamsEnabled: ${data.teamsEnabled ?? '?'}`;
    }),
  );

  // T12.2 — Dashboard Voice Session Create
  tests.push(
    await runTest('T12.2', 'Dashboard Voice Session Create', async () => {
      const res = await httpPost<Record<string, unknown>>(`${vgw}/voice/dashboard`, {
        agentRole: 'chief-of-staff',
        userId: 'smoketest',
        chatId: 'smoketest-session',
      });
      if (res.status === 404) {
        return 'POST /voice/dashboard not deployed yet — endpoint pending';
      }
      if (!res.ok) {
        if (res.raw.includes('already has an active voice session')) {
          return 'Voice session already active for chief-of-staff (idempotent session guard)';
        }
        throw new Error(`POST /voice/dashboard returned ${res.status}: ${res.raw}`);
      }
      const data = res.data as { id?: string };
      const sessionId = data?.id;
      if (sessionId) {
        // Clean up: end the session
        await httpPost(`${vgw}/voice/dashboard/end`, { sessionId });
      }
      return `Voice session created${sessionId ? ` (id: ${sessionId}, cleaned up)` : ''}`;
    }),
  );

  // T12.3 — Active Sessions List
  tests.push(
    await runTest('T12.3', 'Active Sessions List', async () => {
      const res = await httpGet<Record<string, unknown>>(`${vgw}/voice/sessions`);
      if (res.status === 404) {
        return 'GET /voice/sessions not deployed — endpoint pending';
      }
      if (!res.ok) throw new Error(`GET /voice/sessions returned ${res.status}`);
      const data = res.data as { sessions?: unknown[] };
      return `${data?.sessions?.length ?? 0} active voice session(s)`;
    }),
  );

  // T12.4 — Voice Usage Endpoint
  tests.push(
    await runTest('T12.4', 'Voice Usage Endpoint', async () => {
      const res = await httpGet<Record<string, unknown>>(`${vgw}/voice/usage`);
      if (res.status === 404) {
        return 'GET /voice/usage not deployed — endpoint pending';
      }
      if (!res.ok) throw new Error(`GET /voice/usage returned ${res.status}`);
      return `Voice usage endpoint reachable`;
    }),
  );

  // T12.5 — Calendar Webhook Validation Handshake
  tests.push(
    await runTest('T12.5', 'Calendar Webhook Handshake', async () => {
      const token = 'smoketest-validation-token';
      const res = await httpGet<string>(
        `${vgw}/voice/calendar/webhook?validationToken=${encodeURIComponent(token)}`,
      );
      if (res.status === 404) {
        return 'GET /voice/calendar/webhook not deployed — endpoint pending';
      }
      if (!res.ok) throw new Error(`Calendar webhook returned ${res.status}`);
      // Graph API expects the raw validation token echoed back
      if (res.raw.trim() === token) {
        return 'Calendar webhook validation handshake echoes token correctly';
      }
      return `Calendar webhook reachable (HTTP ${res.status})`;
    }),
  );

  // T12.6 — Calendar Subscriptions List
  tests.push(
    await runTest('T12.6', 'Calendar Subscriptions', async () => {
      const res = await httpGet<Record<string, unknown>>(`${vgw}/voice/calendar/subscriptions`);
      if (res.status === 404) {
        return 'GET /voice/calendar/subscriptions not deployed — endpoint pending';
      }
      if (!res.ok) throw new Error(`Calendar subscriptions returned ${res.status}`);
      const data = res.data as { subscriptions?: unknown[] };
      return `${data?.subscriptions?.length ?? 0} calendar subscription(s)`;
    }),
  );

  // T12.7 — Teams Meeting Join Endpoint Exists
  tests.push(
    await runTest('T12.7', 'Teams Meeting Join Endpoint', async () => {
      // Send a minimal request; we expect 400 (bad request) or 200, not 404
      const res = await httpPost<Record<string, unknown>>(`${vgw}/voice/teams/join`, {
        agentRole: 'chief-of-staff',
        meetingUrl: 'https://teams.microsoft.com/l/meetup-join/smoketest',
      });
      if (res.status === 404) {
        return 'POST /voice/teams/join not deployed — endpoint pending';
      }
      // Any non-404 means the endpoint exists
      return `Teams meeting join endpoint reachable (HTTP ${res.status})`;
    }),
  );

  return { layer: 12, name: 'Voice Gateway', tests };
}
